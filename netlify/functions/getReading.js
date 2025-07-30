// netlify/functions/getReading.js

const { MongoClient } = require("mongodb");
let clientPromise;

async function getClient() {
  if (!clientPromise) {
    clientPromise = (async () => {
      const client = new MongoClient(process.env.MONGO_URI);
      await client.connect();
      return client;
    })();
  }
  return clientPromise;
}

exports.handler = async (event) => {
  try {
    // 1) Required params
    const { ean, start, end, type, direction, limit } = event.queryStringParameters || {};
    if (!ean || !start || !end || !type || !direction) {
      return {
        statusCode: 400,
        body: "Missing one of: ean, start, end, type, direction"
      };
    }

    // 2) Parse dates & pick prefix
    const startDt = new Date(start);
    const endDt   = new Date(end);
    const prefix  = direction === "Teruglevering" ? "dial_280_calc" : "dial_180_calc";

    console.log(`🔍 Querying EAN=${ean}, prefix=${prefix}, from ${startDt.toISOString()} to ${endDt.toISOString()}`);

    // 3) Fetch documents
    const client = await getClient();
    const coll   = client.db("ikehu").collection("reading_day");
    const docs   = await coll
      .find({ "metadata.ean": ean })
      .project({ readings: 1, _id: 0 })
      .toArray();
    console.log(`📖 Matched docs: ${docs.length}`);

    // 4) Extract & filter
    let rawCount = 0, keptCount = 0;
    let readings = [];

    docs.forEach(doc => {
      const rd = doc.readings[prefix] || {};
      for (const [ts, raw] of Object.entries(rd)) {
        rawCount++;
        const dt = new Date(ts);
        if (dt < startDt || dt >= endDt) continue;
        keptCount++;
        let val = Number(raw);
        if (type === "Elektriciteit") val /= 1000;
        readings.push({ datetime: dt.toISOString(), ean, raw: val });
      }
    });

    console.log(`⏳ Scanned ${rawCount}, kept ${keptCount}`);

    // 5) Sort & diff
    readings.sort((a, b) => new Date(a.datetime) - new Date(b.datetime));
    let lastRaw = null;
    let result = readings.map(r => {
      const value = lastRaw === null ? 0 : (r.raw - lastRaw);
      lastRaw = r.raw;
      return { datetime: r.datetime, ean: r.ean, value };
    });

    // 6) Apply limit for quick tests
    if (limit) {
      const n = parseInt(limit, 10);
      if (!isNaN(n) && n > 0) result = result.slice(0, n);
      console.log(`✂️ Sliced to first ${result.length} rows`);
    }

    // 7) Return JSON
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(result)
    };

  } catch (err) {
    console.error("❗ getReading error:", err);
    return {
      statusCode: 500,
      body: "Internal server error"
    };
  }
};
