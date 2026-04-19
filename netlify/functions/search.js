const https = require('https');

exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { query, restaurants, offset = 0, count = 3 } = JSON.parse(event.body);

    // Pre-filter by hard fields
    const lower = query.toLowerCase();
    let filtered = [...restaurants];

    const cities = ['תל אביב', 'ירושלים', 'חיפה', 'הגליל', 'הנגב', 'יפו', 'פלורנטין', 'נווה צדק', 'רמת גן', 'הרצליה'];
    const mentionedCity = cities.find(c => query.includes(c));
    if (mentionedCity) {
      const cityFiltered = filtered.filter(r =>
        (r.location_city && r.location_city.includes(mentionedCity)) ||
        (r.location_neighborhood && r.location_neighborhood.includes(mentionedCity)) ||
        (r.location_area && r.location_area.includes(mentionedCity))
      );
      if (cityFiltered.length >= 2) filtered = cityFiltered;
    }

    if (lower.includes('כשר')) {
      const kosherFiltered = filtered.filter(r => r.kosher && r.kosher !== 'לא');
      if (kosherFiltered.length >= 2) filtered = kosherFiltered;
    }

    const list = filtered.map((r, i) =>
      `${i+1}. שם: ${r.name} | עיר: ${r.location_city} | שכונה: ${r.location_neighborhood} | סגנון: ${r.style} | מחיר: ${r.price_range} | אווירה: ${r.vibe} | מתאים ל: ${r.occasion} | דיאטה: ${r.diet} | כשר: ${r.kosher} | זמן: ${r.time_of_day} | ימים: ${r.day}`
    ).join('\n');

    const prompt = `אתה מנוע המלצות מסעדות. קיבלת בקשה ורשימת מסעדות.

בקשה: "${query}"

מסעדות:
${list}

דרג לפי התאמה. ענה בפורמט: מספר|סיבה קצרה
שורה אחת לכל מסעדה, ללא טקסט אחר.`;

    const requestBody = JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      messages: [{ role: 'user', content: prompt }]
    });

    const responseText = await new Promise((resolve, reject) => {
      const req = https.request({
        hostname: 'api.anthropic.com',
        path: '/v1/messages',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'Content-Length': Buffer.byteLength(requestBody)
        }
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve(data));
      });
      req.on('error', reject);
      req.write(requestBody);
      req.end();
    });

    const data = JSON.parse(responseText);

    if (!data.content || !data.content[0]) {
      console.error('Unexpected API response:', responseText);
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          results: filtered.slice(offset, offset + count).map(r => ({ restaurant: r, reason: 'המלצה כללית' })),
          hasMore: filtered.length > offset + count,
          totalFound: filtered.length
        })
      };
    }

    const text = data.content[0].text.trim();
    const ranked = [];
    text.split('\n').forEach(line => {
      const parts = line.split('|');
      if (parts.length >= 2) {
        const idx = parseInt(parts[0].trim()) - 1;
        const reason = parts[1].trim();
        if (!isNaN(idx) && idx >= 0 && idx < filtered.length) {
          ranked.push({ restaurant: filtered[idx], reason });
        }
      }
    });

    if (ranked.length === 0) {
      filtered.forEach(r => ranked.push({ restaurant: r, reason: 'התאמה כללית' }));
    }

    const page = ranked.slice(offset, offset + count);
    const hasMore = ranked.length > offset + count;

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ results: page, hasMore, totalFound: ranked.length })
    };

  } catch(e) {
    console.error('Function error:', e.message, e.stack);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: e.message })
    };
  }
};
