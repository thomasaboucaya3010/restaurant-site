const https = require('https');

const ADJACENT = {
  'פלורנטין': ['נחלת בנימין', 'כרם התימנים', 'יפו'],
  'נחלת בנימין': ['פלורנטין', 'כרם התימנים', 'שוק הכרמל', 'מרכז'],
  'כרם התימנים': ['פלורנטין', 'נחלת בנימין', 'נווה צדק'],
  'נווה צדק': ['כרם התימנים', 'פלורנטין', 'יפו'],
  'שוק הכרמל': ['נחלת בנימין', 'מרכז', 'כרם התימנים'],
  'מרכז': ['שוק הכרמל', 'נחלת בנימין', 'לב העיר', 'אבן גבירול'],
  'לב העיר': ['מרכז', 'אבן גבירול', 'כיכר רבין'],
  'אבן גבירול': ['מרכז', 'לב העיר', 'גן החשמל', 'צפון תל אביב'],
  'גן החשמל': ['אבן גבירול', 'צפון תל אביב', 'מרכז'],
  'צפון תל אביב': ['אבן גבירול', 'גן החשמל'],
  'יפו': ['נחלת בנימין', 'כרם התימנים', 'נווה צדק'],
  'יפו העתיקה': ['יפו', 'נחלת בנימין'],
  'מונטיפיורי': ['מרכז', 'נחלת בנימין', 'לב העיר'],
  'הצפון הישן': ['צפון תל אביב', 'אבן גבירול'],
  'שרונה': ['מרכז', 'אבן גבירול'],
  'שכונת התקווה': ['יפו', 'פלורנטין'],
};

const PRICE_MAP = {
  'זול מאוד': 1, 'זול': 2, 'סביר': 3, 'יקר': 4, 'יקר מאוד': 5
};

const MEAL_MAP = {
  'בוקר': 'ארוחת בוקר', 'בראנץ': 'ארוחת בוקר', 'צהריים': 'צהריים',
  'ערב': 'ערב', 'לילה': 'לייט נייט', 'לייט נייט': 'לייט נייט'
};

exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { query, restaurants, offset = 0, count = 3, filters = {} } = JSON.parse(event.body);
    const { city, neighborhood, locationFlexibility = 'city', day, meal, groupSize, dietary, priceMax } = filters;

    // Step 1: Active only
    let pool = restaurants.filter(r => {
      const active = (r['Active (Yes/No)'] || '').trim();
      return active === 'כן' || active === 'yes' || active === 'Yes';
    });

    // Step 2: ELIMINATION
    if (city) {
      const cf = pool.filter(r => {
        const rc = (r['City'] || '').trim();
        return rc.includes(city) || city.includes(rc);
      });
      if (cf.length >= 2) pool = cf;
    }

    if (day && day !== 'לא משנה') {
      const df = pool.filter(r => {
        const od = (r['Open days'] || '').trim();
        if (!od) return true;
        if (od.includes('א–ש') || od.includes('כל השבוע')) return true;
        if (day === 'שישי') return od.includes('שישי') || od.includes('ו') || od.includes('א–ו') || od.includes('א–ש');
        if (day === 'שבת') return od.includes('שבת') || od.includes('ש') || od.includes('א–ש');
        if (day === 'אמצע שבוע') return od.includes('א') || od.includes('ה') || od.includes('א–ה') || od.includes('א–ש');
        return true;
      });
      if (df.length >= 2) pool = df;
    }

    if (meal) {
      const mealKey = MEAL_MAP[meal] || meal;
      const mf = pool.filter(r => {
        const meals = (r['Meals served'] || '').trim();
        if (!meals) return true;
        return meals.includes(mealKey) || meals.includes(meal);
      });
      if (mf.length >= 2) pool = mf;
    }

    if (dietary && dietary !== 'אין') {
      const dietF = pool.filter(r => (r['Dietary'] || '').includes(dietary));
      if (dietF.length >= 1) pool = dietF;
    }

    if (groupSize && parseInt(groupSize) >= 7) {
      const gf = pool.filter(r => (r['Group size'] || '').includes('קבוצה גדולה'));
      if (gf.length >= 2) pool = gf;
    }

    // Step 3: SCORE
    const scored = pool.map(r => {
      let score = 0;
      const rating = parseFloat(r['My rating (1-5)'] || 0);
      score += rating * 3;

      if (neighborhood) {
        const rN = (r['Neighborhood'] || '').trim();
        const normN = neighborhood.replace('(כללי)', '').trim();
        if (rN.includes(normN) || normN.includes(rN)) {
          score += 3;
        } else if (locationFlexibility === 'adjacent' || locationFlexibility === 'city') {
          const adj = ADJACENT[normN] || [];
          const isAdj = adj.some(a => rN.includes(a) || a.includes(rN));
          if (isAdj) score += locationFlexibility === 'adjacent' ? 2 : 1;
        }
      }

      const bestFor = (r['Best for'] || '').trim();
      if (bestFor) {
        bestFor.split(',').forEach(term => {
          const t = term.trim();
          if (query.includes(t) || t.split(' ').some(w => query.includes(w))) score += 3;
        });
      }

      const occasion = (r['Occasion'] || '').trim();
      if (occasion) {
        occasion.split(',').forEach(term => {
          const t = term.trim();
          if (query.includes(t) || t.split(' ').some(w => w.length > 2 && query.includes(w))) score += 2;
        });
      }

      const vibe = (r['Vibe'] || '').trim();
      if (vibe) {
        vibe.split(',').forEach(term => {
          const t = term.trim();
          if (query.includes(t) || t.split(' ').some(w => w.length > 2 && query.includes(w))) score += 2;
        });
      }

      if (priceMax) {
        const rPrice = PRICE_MAP[(r['Price range'] || '').trim()] || 3;
        const maxPrice = PRICE_MAP[priceMax] || 5;
        if (rPrice <= maxPrice) score += 1;
        else score -= 2;
      }

      return { restaurant: r, score };
    });

    scored.sort((a, b) => b.score - a.score);
    const topCandidates = scored.slice(0, 15);

    if (topCandidates.length === 0) {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ results: [], hasMore: false, totalFound: 0 })
      };
    }

    // Step 4: Claude picks best 3 indices (no generated text)
    const restaurantList = topCandidates.map((item, i) => {
      const r = item.restaurant;
      return `${i + 1}. ${r['Name']} | עיר: ${r['City']} | שכונה: ${r['Neighborhood']} | סוג: ${r['Type']} | מטבח: ${r['Cuisine']} | מחיר: ${r['Price range']} | דירוג: ${r['My rating (1-5)']} | הכי טוב ל: ${r['Best for']} | אירוע: ${r['Occasion']} | גודל קבוצה: ${r['Group size']} | אווירה: ${r['Vibe']} | תזונה: ${r['Dietary']} | ימים: ${r['Open days']} | ארוחות: ${r['Meals served']}`;
    }).join('\n');

    const systemPrompt = `You are a restaurant recommendation assistant for a curated list of restaurants, bars, and cafes. You will be given a structured database of venues and a user request. Your job is to pick the 3 best matches. Filter out venues that clearly don't match hard requirements (wrong city, wrong group size, doesn't serve the right meal, missing dietary needs). Then rank by how well the venue fits the occasion, vibe, and the curator's personal rating. Return ONLY a JSON array of 3 indices (1-based), varied in style or price where possible. Format: [1, 3, 7] — nothing else.`;

    const userMessage = `בקשת המשתמש: "${query}"\n\nמסעדות:\n${restaurantList}\n\nהחזר JSON בלבד: מערך של 3 מספרים.`;

    const requestBody = JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 50,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }]
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

    const apiData = JSON.parse(responseText);
    let rawText = (apiData.content[0].text || '').trim().replace(/```json\n?/g,'').replace(/```\n?/g,'').trim();

    let indices = [];
    try {
      indices = JSON.parse(rawText);
    } catch(e) {
      indices = topCandidates.slice(0, 3).map((_, i) => i + 1);
    }

    const allResults = indices.map(idx => {
      const item = topCandidates[idx - 1];
      if (!item) return null;
      return { restaurant: item.restaurant, score: item.score };
    }).filter(Boolean);

    const results = allResults.slice(offset, offset + count);
    const hasMore = allResults.length > offset + count;

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ results, hasMore, totalFound: allResults.length })
    };

  } catch(e) {
    console.error('Function error:', e.message, e.stack);
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
