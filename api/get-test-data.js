// 文件名: api/get-test-data.js

const FEISHU_CONFIG = {
    app_id: 'cli_a9f232801c389cc8',
    app_secret: 'LE5aYm8IABsEPxeiQPZUyh3RMJPaYGVq',
    app_token: 'Zj9VbXd86adTS3sWAaocizp1nxe',
    table_id: 'tblm28fM4Gtsf1IU' 
};

async function getTenantAccessToken() {
    const url = 'https://open.feishu.cn/open-api/auth/v3/tenant_access_token/internal';
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ app_id: FEISHU_CONFIG.app_id, app_secret: FEISHU_CONFIG.app_secret })
    });
    const data = await response.json();
    if (data.code !== 0) throw new Error('获取access_token失败: ' + data.msg);
    return data.tenant_access_token;
}

async function getRecordById(recordId, accessToken) {
    const url = 'https://open.feishu.cn/open-api/bitable/v1/apps/' + FEISHU_CONFIG.app_token + '/tables/' + FEISHU_CONFIG.table_id + '/records/' + recordId;
    const response = await fetch(url, {
        method: 'GET',
        headers: { 'Authorization': 'Bearer ' + accessToken, 'Content-Type': 'application/json' }
    });
    const data = await response.json();
    if (data.code !== 0) throw new Error('获取飞书记录失败: ' + data.msg);
    return data.data.record;
}

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        const recordId = req.query.rid;
        if (!recordId) return res.status(400).json({ error: '缺少记录ID', success: false });

        const accessToken = await getTenantAccessToken();
        const record = await getRecordById(recordId, accessToken);
        
        const studentName = record.fields['学生姓名'] || '未知学生';
        let questionsJson = record.fields['AI出题结果'];

        if (!questionsJson) return res.status(404).json({ error: '未找到题目数据', success: false });

        let questions = null;
        let innerContent = "";

        // 解析飞书里的复杂JSON
        try {
            let parsedRaw = (typeof questionsJson === 'string') ? JSON.parse(questionsJson) : questionsJson;
            if (parsedRaw.output && parsedRaw.output.choices) {
                innerContent = parsedRaw.output.choices[0].message.content;
            } else {
                innerContent = (typeof questionsJson === 'string') ? questionsJson : JSON.stringify(questionsJson);
            }
            // 强力正则提取数组
            const match = innerContent.match(/\[\s*\{.*\}\s*\]/s);
            questions = match ? JSON.parse(match[0]) : JSON.parse(innerContent);
        } catch (e) {
            return res.status(500).json({ error: 'JSON解析失败', detail: e.message, success: false });
        }

        return res.status(200).json({
            success: true,
            data: { studentName, questions, total: questions.length }
        });
        
    } catch (error) {
        return res.status(500).json({ error: '服务器错误: ' + error.message, success: false });
    }
}
