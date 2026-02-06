// 文件名: api/get-test-data.js

const FEISHU_CONFIG = {
    app_id: 'cli_a9f232801c389cc8',
    app_secret: 'LE5aYm8IABsEPxeiQPZUyh3RMJPaYGVq',
    app_token: 'Zj9VbXd86adTS3sWAaocizp1nxe',
    table_id: 'tblm28fM4Gtsf1IU' 
};

// --- 自动清洗函数 (专治各种复制粘贴错误) ---
function clean(str) {
    if (!str) return '';
    // 移除 URL 参数(?及后面)、Markdown符号、空格、换行
    return str.split('?')[0].split('&')[0].replace(/\[|\]|\(|\)| /g, '').trim();
}

const FEISHU_CONFIG = {
    app_id: clean(CONFIG_RAW.app_id),
    app_secret: clean(CONFIG_RAW.app_secret),
    app_token: clean(CONFIG_RAW.app_token),
    table_id: clean(CONFIG_RAW.table_id)
};

// 辅助：安全的 Fetch 请求
async function safeFetch(url, options, stepName) {
    console.log(`[${stepName}] 请求 URL: ${url}`);
    const response = await fetch(url, options);
    const text = await response.text(); // 先取文本，防止 JSON 解析挂掉

    if (!response.ok) {
        throw new Error(`[${stepName}] HTTP错误 ${response.status}: ${text.substring(0, 100)}...`);
    }

    try {
        const json = JSON.parse(text);
        if (json.code !== 0) {
            throw new Error(`[${stepName}] 飞书API报错 (Code ${json.code}): ${json.msg}`);
        }
        return json;
    } catch (e) {
        // 如果不是 JSON，说明返回了 HTML 错误页（通常是 ID 填错了导致 404）
        throw new Error(`[${stepName}] 返回了非 JSON 数据 (可能是 URL 拼写错误): ${text.substring(0, 50)}...`);
    }
}

export default async function handler(req, res) {
    // CORS 配置
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        const recordId = clean(req.query.rid);
        if (!recordId) return res.status(400).json({ error: '缺少 rid 参数', success: false });

        // 1. 获取 Access Token
        const tokenUrl = 'https://open.feishu.cn/open-api/auth/v3/tenant_access_token/internal';
        const tokenData = await safeFetch(tokenUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ app_id: FEISHU_CONFIG.app_id, app_secret: FEISHU_CONFIG.app_secret })
        }, '获取Token');
        
        const accessToken = tokenData.tenant_access_token;

        // 2. 获取记录详情
        // 确保 URL 没有多余的斜杠或字符
        const recordUrl = `https://open.feishu.cn/open-api/bitable/v1/apps/${FEISHU_CONFIG.app_token}/tables/${FEISHU_CONFIG.table_id}/records/${recordId}`;
        const recordRes = await safeFetch(recordUrl, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${accessToken}` }
        }, '获取记录');

        const record = recordRes.data.record;
        
        // 3. 解析 AI 数据
        let questionsJson = record.fields['AI出题结果'];
        if (!questionsJson) throw new Error('找到记录了，但"AI出题结果"这一列是空的！');

        let questions = null;
        let innerContent = "";

        // 强力解析逻辑
        try {
            let parsedRaw = (typeof questionsJson === 'string') ? JSON.parse(questionsJson) : questionsJson;
            // 兼容 DeepSeek 结构和直接数组结构
            if (parsedRaw.output && parsedRaw.output.choices) {
                innerContent = parsedRaw.output.choices[0].message.content;
            } else {
                innerContent = (typeof questionsJson === 'string') ? questionsJson : JSON.stringify(questionsJson);
            }
            // 正则提取数组
            const match = innerContent.match(/\[\s*\{.*\}\s*\]/s);
            questions = match ? JSON.parse(match[0]) : JSON.parse(innerContent);
        } catch (e) {
            throw new Error(`AI数据解析失败: ${e.message}. 原始数据前50字: ${String(questionsJson).substring(0,50)}`);
        }

        return res.status(200).json({
            success: true,
            data: { 
                studentName: record.fields['学生姓名'] || '未知',
                questions: questions
            }
        });

    } catch (error) {
        // 返回详细的错误信息，不再显示奇怪的 Position 4
        return res.status(500).json({ 
            error: error.message, 
            config_check: {
                app_id_len: FEISHU_CONFIG.app_id ? FEISHU_CONFIG.app_id.length : 0,
                token_len: FEISHU_CONFIG.app_token ? FEISHU_CONFIG.app_token.length : 0,
                table_len: FEISHU_CONFIG.table_id ? FEISHU_CONFIG.table_id.length : 0
            },
            success: false 
        });
    }
}
