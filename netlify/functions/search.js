exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { query, restaurants } = JSON.parse(event.body);

    const list = restaurants.map((r, i) =>
      `${i+1}. שם: ${r.name} | עיר: ${r.location_city} | שכונה: ${r.location_neighborhood} | סגנון: ${r.style} | מחיר: ${r.price_range} | אווירה: ${r.vibe} | מתאים ל: ${r.occasion} | דיאטה: ${r.diet} | כשר: ${r.kosher} | זמן: ${r.time_of_day} | ימים: ${r.day} | קבוצה: ${r.group_size}`
    ).join('\n');

    const prompt = `אתה מנוע המלצות מסעדות חכם. קיבלת בקשה בעברית ורשימת מסעדות.

בקשת המשתמש: "${query}"

רשימת המסעדות:
${list}

בחר את 3 המסעדות המתאימות ביותר לבקשה. התחשב בכל הפרטים — מיקום, אווירה, תקציב, הזדמנות, דיאטה וכו'.
אם יש פחות מ-3 מסעדות, החזר את כולן לפי סדר התאמה.

ענה אך ורק במספרים מופרדים בפסיקים, לדוגמה: 2,1,3
ללא טקסט נוסף.`;

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 20,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const data = await res.json();
    const text = data.content[0].text.trim();

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ result: text })
    };

  } catch(e) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: e.message })
    };
  }
};
