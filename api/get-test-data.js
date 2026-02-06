// 文件名: api/get-test-data.js

// 1. 引入必要的工具
import { URL } from 'url';

// ===== 配置区域 (请在这里填入你的真实信息) =====
const CONFIG_RAW = {
    // 你的飞书 App ID (cli_开头)
    app_id: 'cli_a9f232801c389cc8', 
    
    // 你的 App Secret
    app_secret: 'LE5aYm8IABsEPxeiQPZUyh3RMJPaYGVq',
    
    // 你的多维表格 Token (base开头, 在浏览器地址栏找)
    app_token: 'Zj9VbXd86adTS3sWAaocizp1nxe',
    
    // 你的数据表 ID (tbl开头, 在浏览器地址栏找)
    table_id: 'tblm28fM4Gtsf1IU'
};

// --- 工具函数：清洗配置项 (自动去掉空格、括号、链接符号) ---
function clean(str) {
    if (!str) return '';
    // 移除 Markdown 链接格式、URL参数、空格、换行
    return str.replace(/\[.*?\]\(.*?\)/g, '$1') // 尝试提取markdown链接文本
              .split('?')[0]
              .split('&')[0]
              .replace(/['"\[\]\(\)\s]/g, '') // 去掉引号、括号、空格
              .trim();
}

// 生成清洗后的配置
const FEISHU_CONFIG = {
    app_id: clean(CONFIG_RAW.app_id),
    app_secret: clean(CONFIG_RAW.app_secret),
    app_token: clean(CONFIG_RAW.app_token),
    table_id: clean(CONFIG_RAW.table_id)
};

// --- 工具函数：安全的 Fetch 请求 ---
async function safeFetch(url, options, stepName) {
    console.log(`[${stepName}] 请求: ${url}`);
    try {
        const response = await fetch(url, options);
        const text = await response.text(); // 先取文本，防止 JSON 解析挂掉

        if (!response.ok) {
            throw new Error(`[${stepName}] HTTP错误 ${response.status}: ${text.substring(0, 200)}`);
        }

        try {
            const json = JSON.parse(text);
            if (json.code !== 0) {
                throw new Error(`[${stepName}] 飞书API报错 (Code ${json.code}): ${json.msg}`);
            }
            return json;
        } catch (e) {
            if (e.message.includes('飞书API报错')) throw e;
            // 如果不是 JSON，说明返回了 HTML 错误页
            throw new Error(`[${stepName}] 返回了非 JSON 数据 (可能是 URL 拼写错误): ${text.substring(0, 100)}...`);
        }
    } catch (error) {
        throw new Error(`网络请求失败 (${stepName}): ${error.message}`);
    }
}

// --- 主处理函数 ---
export default async function handler(req, res) {
    // 1. 设置跨域 (CORS) - 允许任何网站访问此接口
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    // 处理预检请求
    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        // 2. 获取记录 ID
        const recordId = clean(req.query.rid);
        if (!recordId) return res.status(400).json({ error: '请在URL中提供 rid 参数 (例如: ?rid=recXXXX)', success: false });

        // 3. 获取 Access Token
        const tokenUrl = 'https://open.feishu.cn/open-api/auth/v3/tenant_access_token/internal';
        const tokenData = await safeFetch(tokenUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ app_id: FEISHU_CONFIG.app_id, app_secret: FEISHU_CONFIG.app_secret })
        }, '获取Token');
        
        const accessToken = tokenData.tenant_access_token;

        // 4. 获取记录详情
        const recordUrl = `https://open.feishu.cn/open-api/bitable/v1/apps/${FEISHU_CONFIG.app_token}/tables/${FEISHU_CONFIG.table_id}/records/${recordId}`;
        const recordRes = await safeFetch(recordUrl, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${accessToken}` }
        }, '获取记录');

        const record = recordRes.data.record;
        
        // 5. 解析 AI 数据
        let questionsJson = record.fields['AI出题结果'];
        if (!questionsJson) throw new Error('找到记录了，但"AI出题结果"这一列是空的！请检查飞书表格是否已生成内容。');

        let questions = null;
        let innerContent = "";

        // 智能解析逻辑
        try {
            // 尝试把字段内容当做字符串解析
            let parsedRaw = (typeof questionsJson === 'string') ? JSON.parse(questionsJson) : questionsJson;
            
            // 兼容 DeepSeek 结构
            if (parsedRaw.output && parsedRaw.output.choices) {
                innerContent = parsedRaw.output.choices[0].message.content;
            } else {
                innerContent = (typeof questionsJson === 'string') ? questionsJson : JSON.stringify(questionsJson);
            }
            
            // 提取 JSON 数组 [ ... ]
            const match = innerContent.match(/\[\s*\{.*\}\s*\]/s);
            if (match) {
                questions = JSON.parse(match[0]);
            } else {
                // 如果没有数组结构，尝试直接解析
                questions = JSON.parse(innerContent);
            }
        } catch (e) {
            throw new Error(`AI数据解析失败: ${e.message}. 原始数据前50字: ${String(questionsJson).substring(0,50)}`);
        }

        // 6. 返回成功结果
        return res.status(200).json({
            success: true,
            data: { 
                studentName: record.fields['学生姓名'] || '未知',
                questions: questions,
                total: questions.length
            }
        });

    } catch (error) {
        // 7. 返回错误信息 (不再是 500 崩溃，而是明确的 JSON 错误)
        console.error(error);
        return res.status(500).json({ 
            error: error.message, 
            debug_config: {
                app_id_check: FEISHU_CONFIG.app_id ? "已填" : "未填",
                token_check: FEISHU_CONFIG.app_token ? "已填" : "未填"
            },
            success: false 
        });
    }
}
