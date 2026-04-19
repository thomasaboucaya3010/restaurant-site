exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { query, restaurants, offset = 0, count = 3 } = JSON.parse(event.body);

    // Step 1: pre-filter by hard fields to reduce list size
    const lower = query.toLowerCase();
    let filtered = restaurants;

    // kosher filter
    if (lower.includes('כשר')) {
      filtered = filtered.filter(r => r.kosher && r.kosher !== 'לא');
    }

    // city/area filter - check if query mentions a city
    const cities = ['תל אביב', 'ירושלים', 'חיפה', 'הגליל', 'הנגב', 'יפו', 'פלורנטין', 'נווה צדק', 'רמת גן', 'הרצליה'];
    const mentionedCity = cities.find(c => query.includes(c));
    if (mentionedCity) {
      const cityFiltered = filtered.filter(r =>
        (r.location_city && r.location_city.includes(mentionedCity)) ||
        (r.location_neighborhood && r.location_neighborhood.includes(mentionedCity)) ||
        (r.location_area && r.location_area.includes(mentionedCity))
      );
      if (cityFiltered.length >= 3) filtered = cityFiltered;
    }

    // budget filter
    if (lower.includes('זול') || lower.includes('עד 50')) {
      const cheap = filtered.filter(r => r.price_range && (r.price_range.includes('50') || r.price_range.includes('זול')));
      if (cheap.length >= 2) filtered = cheap;
    }
    if (lower.includes('100-200') || lower.includes('100–200')) {
      const mid = filtered.filter(r => r.price_range && r.price_range.includes('100'));
      if (mid.length >= 2) filtered = mid;
    }

    const list = filtered.map((r, i) =>
      `${i+1}. שם: ${r.name} | עיר: ${r.location_city} | שכונה: ${r.location_neighborhood} | סגנון: ${r.style} | מחיר: ${r.price_range} | אווירה: ${r.vibe} | מתאים ל: ${r.occasion} | דיאטה: ${r.diet} | כשר: ${r.kosher} | זמן: ${r.time_of_day} | ימים: ${r.day} | קבוצה: ${r.group_size}`
    ).join('\n');

    const prompt = `אתה מנוע המלצות מסעדות חכם. קיבלת בקשה בעברית ורשימת מסעדות.

בקשת המשתמש: "${query}"

רשימת המסעדות:
${list}

דרג את כל המסעדות לפי התאמה לבקשה, מהמתאים ביותר לפחות מתאים.
עבור כל מסעדה שאתה בוחר, תן משפט קצר (עד 10 מילים) שמסביר למה היא מתאימה.

ענה אך ורק בפורמט הזה, שורה אחת לכל מסעדה, ללא טקסט נוסף:
מספר|סיבה קצרה

לדוגמה:
3|אינטימי ושקט, מתאים לדייט בערב
1|מחיר נוח, אווירה קז'ואל
2|פתוח מאוחר, בר-אוכל כיפי`;

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 300,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const data = await res.json();
    const text = data.content[0].text.trim();

    // Parse ranked results with reasons
    const ranked = [];
    text.split('\n').forEach(line => {
      const parts = line.split('|');
      if (parts.length >= 2) {
        const idx = parseInt(parts[0].trim()) - 1;
        const reason = parts[1].trim();
        if (!isNaN(idx) && idx >= 0 && idx < filtered.length) {
          ranked.push({ restaurant: filtered[idx], reason, originalIndex: idx });
        }
      }
    });

    // fallback if parsing failed
    if (ranked.length === 0) {
      filtered.forEach((r, i) => ranked.push({ restaurant: r, reason: 'התאמה כללית', originalIndex: i }));
    }

    const page = ranked.slice(offset, offset + count);
    const hasMore = ranked.length > offset + count;

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        results: page,
        hasMore,
        totalFound: ranked.length,
        filteredCount: filtered.length
      })
    };

  } catch(e) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: e.message })
    };
  }
};
