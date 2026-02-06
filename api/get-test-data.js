// 文件名: api/get-test-data.js

const FEISHU_CONFIG = {
    app_id: 'cli_a9f232801c389cc8',           // 飞书应用ID
    app_secret: 'LE5aYm8IABsEPxeiQPZUyh3RMJPaYGVq',   // 飞书应用密钥
    app_token: 'Zj9VbXd86adTS3sWAaocizp1nxe',     // 请确认这是你表格的实际Token
    table_id: 'tblm28fM4Gtsf1IU'                  // 【已修复】删除了多余的view参数
};

async function getTenantAccessToken() {
    const response = await fetch('[https://open.feishu.cn/open-api/auth/v3/tenant_access_token/internal](https://open.feishu.cn/open-api/auth/v3/tenant_access_token/internal)', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ app_id: FEISHU_CONFIG.app_id, app_secret: FEISHU_CONFIG.app_secret })
    });
    const data = await response.json();
    if (data.code !== 0) throw new Error('获取access_token失败: ' + data.msg);
    return data.tenant_access_token;
}

async function getRecordById(recordId, accessToken) {
    const url = `https://open.feishu.cn/open-api/bitable/v1/apps/${FEISHU_CONFIG.app_token}/tables/${FEISHU_CONFIG.table_id}/records/${recordId}`;
    const response = await fetch(url, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' }
    });
    const data = await response.json();
    if (data.code !== 0) throw new Error('获取飞书记录失败 (Code ' + data.code + '): ' + data.msg);
    return data.data.record;
}

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        const recordId = req.query.rid;
        if (!recordId) return res.status(400).json({ error: '缺少记录ID参数', success: false });

        const accessToken = await getTenantAccessToken();
        const record = await getRecordById(recordId, accessToken);
        
        const studentName = record.fields['学生姓名'] || '未知学生';
        let questionsJson = record.fields['AI出题结果'];

        if (!questionsJson) return res.status(404).json({ error: '该记录没有题目数据', success: false });

        // --- 核心修复：强力解析逻辑 ---
        let questions = null;
        try {
            // 如果已经是对象，直接用；如果是字符串，尝试解析
            let parsedRaw = (typeof questionsJson === 'string') ? JSON.parse(questionsJson) : questionsJson;
            
            // 提取 DeepSeek 里的 content 字符串
            let innerContent = "";
            if (parsedRaw.output && parsedRaw.output.choices) {
                innerContent = parsedRaw.output.choices[0].message.content;
            } else {
                innerContent = (typeof questionsJson === 'string') ? questionsJson : JSON.stringify(questionsJson);
            }

            // 【重点】使用正则从一堆文字（或Markdown）中精准抠出 [...] 数组部分
            const match = innerContent.match(/\[\s*\{.*\}\s*\]/s);
            if (match) {
                questions = JSON.parse(match[0]);
            } else {
                // 如果正则没匹配到，尝试直接解析
                questions = JSON.parse(innerContent);
            }
        } catch (parseError) {
            return res.status(500).json({ error: '题目解析失败，请检查AI出题结果格式', detail: parseError.message, success: false });
        }

        return res.status(200).json({
            success: true,
            data: { studentName, recordId, questions, totalQuestions: questions.length }
        });
        
    } catch (error) {
        return res.status(500).json({ error: '服务器错误: ' + error.message, success: false });
    }
}
