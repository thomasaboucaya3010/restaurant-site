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
    const {
      query,
      restaurants,
      offset = 0,
      count = 3,
      filters = {}
    } = JSON.parse(event.body);

    const {
      city,
      neighborhood,
      locationFlexibility = 'city', // 'exact', 'adjacent', 'city'
      day,
      meal,
      groupSize,
      dietary,
      priceMax,
    } = filters;

    // Step 1: Filter only active restaurants
    let pool = restaurants.filter(r => {
      const active = (r['Active (Yes/No)'] || r['active'] || '').trim();
      return active === 'כן' || active === 'yes' || active === 'Yes';
    });

    // Step 2: ELIMINATION filters

    // City - hard filter
    if (city) {
      const cityFiltered = pool.filter(r => {
        const rc = (r['City'] || '').trim();
        return rc.includes(city) || city.includes(rc);
      });
      if (cityFiltered.length >= 2) pool = cityFiltered;
    }

    // Day - hard filter
    if (day && day !== 'לא משנה') {
      const dayMap = {
        'שישי': 'שישי', 'שבת': 'שבת',
        'אמצע שבוע': ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'א', 'ב', 'ג', 'ד', 'ה', 'א–ה']
      };
      const dayFiltered = pool.filter(r => {
        const openDays = (r['Open days'] || '').trim();
        if (!openDays) return true;
        if (openDays.includes('א–ש') || openDays.includes('כל השבוע')) return true;
        if (day === 'שישי') return openDays.includes('שישי') || openDays.includes('ו') || openDays.includes('א–ו') || openDays.includes('א–ש');
        if (day === 'שבת') return openDays.includes('שבת') || openDays.includes('ש') || openDays.includes('א–ש');
        if (day === 'אמצע שבוע') return openDays.includes('א') || openDays.includes('ה') || openDays.includes('א–ה') || openDays.includes('א–ש');
        return true;
      });
      if (dayFiltered.length >= 2) pool = dayFiltered;
    }

    // Meal time - hard filter
    if (meal) {
      const mealKey = MEAL_MAP[meal] || meal;
      const mealFiltered = pool.filter(r => {
        const meals = (r['Meals served'] || '').trim();
        if (!meals) return true;
        return meals.includes(mealKey) || meals.includes(meal);
      });
      if (mealFiltered.length >= 2) pool = mealFiltered;
    }

    // Dietary - hard filter
    if (dietary && dietary !== 'אין') {
      const dietFiltered = pool.filter(r => {
        const diet = (r['Dietary'] || '').trim();
        if (!diet) return false;
        return diet.includes(dietary);
      });
      if (dietFiltered.length >= 1) pool = dietFiltered;
    }

    // Group size - hard filter for large groups
    if (groupSize && parseInt(groupSize) >= 7) {
      const groupFiltered = pool.filter(r => {
        const gs = (r['Group size'] || '').trim();
        return gs.includes('קבוצה גדולה') || gs.includes('גדול');
      });
      if (groupFiltered.length >= 2) pool = groupFiltered;
    }

    // Step 3: SCORE remaining restaurants
    const scored = pool.map(r => {
      let score = 0;
      const reasons = [];

      // Rating score (weight x3) - most important
      const rating = parseFloat(r['My rating (1-5)'] || r['my rating'] || 0);
      score += rating * 3;

      // Neighborhood scoring with flexibility
      if (neighborhood) {
        const rNeighborhood = (r['Neighborhood'] || '').trim();
        const normalizedN = neighborhood.replace('(כללי)', '').trim();

        if (rNeighborhood.includes(normalizedN) || normalizedN.includes(rNeighborhood)) {
          score += 3;
          reasons.push('שכונה מדויקת');
        } else if (locationFlexibility === 'adjacent' || locationFlexibility === 'city') {
          const adjacentList = ADJACENT[normalizedN] || [];
          const isAdjacent = adjacentList.some(adj =>
            rNeighborhood.includes(adj) || adj.includes(rNeighborhood)
          );
          if (isAdjacent) {
            score += locationFlexibility === 'adjacent' ? 2 : 1;
            reasons.push('שכונה סמוכה');
          }
        }
      }

      // Best for match (weight x3)
      const bestFor = (r['Best for'] || '').trim();
      const queryLower = query.toLowerCase();
      if (bestFor && queryLower) {
        const bestForTerms = bestFor.split(',').map(t => t.trim());
        bestForTerms.forEach(term => {
          if (query.includes(term) || term.split(' ').some(w => query.includes(w))) {
            score += 3;
            reasons.push(`מתאים ל: ${term}`);
          }
        });
      }

      // Occasion match (weight x2)
      const occasion = (r['Occasion'] || '').trim();
      if (occasion && query) {
        const occasionTerms = occasion.split(',').map(t => t.trim());
        occasionTerms.forEach(term => {
          if (query.includes(term) || term.split(' ').some(w => w.length > 2 && query.includes(w))) {
            score += 2;
          }
        });
      }

      // Vibe match (weight x2)
      const vibe = (r['Vibe'] || '').trim();
      if (vibe && query) {
        const vibeTerms = vibe.split(',').map(t => t.trim());
        vibeTerms.forEach(term => {
          if (query.includes(term) || term.split(' ').some(w => w.length > 2 && query.includes(w))) {
            score += 2;
          }
        });
      }

      // Price range match (weight x1)
      if (priceMax) {
        const rPrice = PRICE_MAP[(r['Price range'] || '').trim()] || 3;
        const maxPrice = PRICE_MAP[priceMax] || 5;
        if (rPrice <= maxPrice) score += 1;
        else score -= 2;
      }

      return { restaurant: r, score, reasons };
    });

    // Sort by score descending
    scored.sort((a, b) => b.score - a.score);

    // Take top 15 for Claude to reason about
    const topCandidates = scored.slice(0, 15);

    if (topCandidates.length === 0) {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ results: [], hasMore: false, totalFound: 0 })
      };
    }

    // Step 4: Send to Claude with curator prompt
    const restaurantList = topCandidates.map((item, i) => {
      const r = item.restaurant;
      return `${i + 1}. ${r['Name']} | עיר: ${r['City']} | שכונה: ${r['Neighborhood']} | סוג: ${r['Type']} | מטבח: ${r['Cuisine']} | מחיר: ${r['Price range']} | דירוג: ${r['My rating (1-5)']} | הכי טוב ל: ${r['Best for']} | אירוע: ${r['Occasion']} | גודל קבוצה: ${r['Group size']} | אווירה: ${r['Vibe']} | רמת רעש: ${r['Noise level']} | תזונה: ${r['Dietary']} | ימים: ${r['Open days']} | ארוחות: ${r['Meals served']} | הערה אישית: ${r['Personal note']}`;
    }).join('\n');

    const systemPrompt = `You are a restaurant recommendation assistant for a curated list of restaurants, bars, and cafes. You will be given a structured database of venues, each with attributes including type, cuisine, neighborhood, price range, noise level, group size, occasions, vibe, special features, dietary options, meals served, and personal notes written by the curator. When a user asks for a recommendation — either in free text or through guided answers — your job is to first filter out any venues that clearly don't match the hard requirements (wrong city, wrong group size, doesn't serve the right meal, missing a must-have feature), and then rank the remaining matches by: (1) how well the venue fits the specific occasion and vibe requested, and (2) the curator's personal rating. When presenting results, always show exactly 3 recommendations, varied in style or price where possible. For each one, lead with the name and one sentence in the curator's voice explaining why it fits — drawing from the personal notes and "best for" fields. If a hard requirement cannot be met by any venue (e.g. no kosher options in that city), say so clearly and suggest the closest alternative. Respond ONLY with JSON in this exact format, no other text: [{"index": 1, "reason": "one sentence in curator voice"}, {"index": 2, "reason": "..."}, {"index": 3, "reason": "..."}]`;

    const userMessage = `בקשת המשתמש: "${query}"

רשימת המסעדות המסוננות (ממוינות לפי רלוונטיות):
${restaurantList}

בחר 3 המסעדות המתאימות ביותר. החזר JSON בלבד.`;

    const requestBody = JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 500,
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

    if (!apiData.content || !apiData.content[0]) {
      throw new Error('Invalid API response: ' + responseText);
    }

    let rawText = apiData.content[0].text.trim();
    // Strip markdown code fences if present
    rawText = rawText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

    let picks = [];
    try {
      picks = JSON.parse(rawText);
    } catch(e) {
      // fallback: return top 3 scored
      picks = topCandidates.slice(0, 3).map((item, i) => ({
        index: i + 1,
        reason: item.restaurant['Personal note'] || 'המלצה של האוצר'
      }));
    }

    const results = picks.slice(offset, offset + count).map(pick => {
      const item = topCandidates[pick.index - 1];
      if (!item) return null;
      return {
        restaurant: item.restaurant,
        reason: pick.reason,
        score: item.score
      };
    }).filter(Boolean);

    const hasMore = picks.length > offset + count;

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        results,
        hasMore,
        totalFound: topCandidates.length
      })
    };

  } catch(e) {
    console.error('Function error:', e.message, e.stack);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: e.message })
    };
  }
};
