// 文件名: api/get-test-data.js
// 部署到: Vercel

/**
 * 根据记录ID从飞书多维表格读取测试数据
 */

// ===== 配置区域（需要修改） =====
const FEISHU_CONFIG = {
    app_id: 'cli_a9f232801c389cc8',           // 飞书应用ID
    app_secret: 'LE5aYm8IABsEPxeiQPZUyh3RMJPaYGVq',   // 飞书应用密钥
    app_token: 'Zj9VbXd86adTS3sWAaocizp1nxe',     // 多维表格app_token
    table_id: 'tblm28fM4Gtsf1IU&view=vewxwuhsZ6'        // 数据表table_id
};

/**
 * 获取飞书访问令牌
 */
async function getTenantAccessToken() {
    const response = await fetch('https://open.feishu.cn/open-api/auth/v3/tenant_access_token/internal', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            app_id: FEISHU_CONFIG.app_id,
            app_secret: FEISHU_CONFIG.app_secret
        })
    });
    
    const data = await response.json();
    
    if (data.code !== 0) {
        throw new Error('获取access_token失败: ' + data.msg);
    }
    
    return data.tenant_access_token;
}

/**
 * 根据记录ID获取记录详情
 */
async function getRecordById(recordId, accessToken) {
    const url = `https://open.feishu.cn/open-api/bitable/v1/apps/${FEISHU_CONFIG.app_token}/tables/${FEISHU_CONFIG.table_id}/records/${recordId}`;
    
    const response = await fetch(url, {
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
        }
    });
    
    const data = await response.json();
    
    if (data.code !== 0) {
        throw new Error('获取记录失败: ' + data.msg);
    }
    
    return data.data.record;
}

/**
 * Vercel Serverless函数入口
 */
export default async function handler(req, res) {
    // 设置CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    // 处理OPTIONS预检请求
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    
    // 只接受GET请求
    if (req.method !== 'GET') {
        return res.status(405).json({ error: '只支持GET请求' });
    }
    
    try {
        // 获取记录ID
        const recordId = req.query.rid;
        
        if (!recordId) {
            return res.status(400).json({ 
                error: '缺少记录ID参数',
                success: false
            });
        }
        
        // 1. 获取访问令牌
        const accessToken = await getTenantAccessToken();
        
        // 2. 获取记录详情
        const record = await getRecordById(recordId, accessToken);
        
        // 3. 提取需要的字段
        const studentName = record.fields['学生姓名'] || '未知学生';
        const questionsJson = record.fields['AI出题结果'];
        
        if (!questionsJson) {
            return res.status(404).json({
                error: '该记录没有题目数据',
                success: false
            });
        }
        
        // 4. 解析题目数据
        let questions = null;
        
        try {
            // 如果是DeepSeek API返回的格式
            const parsed = JSON.parse(questionsJson);
            
            if (parsed.output && parsed.output.choices && parsed.output.choices[0]) {
                const content = parsed.output.choices[0].message.content;
                questions = JSON.parse(content);
            } else if (Array.isArray(parsed)) {
                questions = parsed;
            } else if (parsed.questions) {
                questions = parsed.questions;
            } else {
                // 尝试正则提取
                const match = questionsJson.match(/\[\s*\{.*\}\s*\]/s);
                if (match) {
                    questions = JSON.parse(match[0]);
                }
            }
        } catch (parseError) {
            return res.status(500).json({
                error: '题目数据格式错误',
                success: false
            });
        }
        
        if (!questions || !Array.isArray(questions) || questions.length === 0) {
            return res.status(500).json({
                error: '题目数据为空或格式错误',
                success: false
            });
        }
        
        // 5. 返回数据
        return res.status(200).json({
            success: true,
            data: {
                studentName: studentName,
                recordId: recordId,
                questions: questions,
                totalQuestions: questions.length
            }
        });
        
    } catch (error) {
        console.error('API错误:', error);
        return res.status(500).json({ 
            error: '服务器错误: ' + error.message,
            success: false
        });
    }
}
