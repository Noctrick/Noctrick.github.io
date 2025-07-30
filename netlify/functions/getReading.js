// netlify/functions/getReadings.js

const { MongoClient } = require("mongodb");

let clientPromise;

/**
 * Returns a cached MongoClient, or creates one if needed.
 */
async function getClient() {
  if (!clientPromise) {
    clientPromise = MongoClient.connect(
      process.env.MONGO_URI,
      { useNewUrlParser: true, useUnifiedTopology: true }
    );
  }
  return clientPromise;
}

/**
 * Netlify Function handler to fetch, filter and diff readings by EAN.
 * Expects query params: ean, start, end, type, direction
 */
exports.handler = async (event) => {
  try {
    // 1) Parse & validate query parameters
    const { ean, start, end, type, direction } = event.queryStringParameters || {};
    if (!ean || !start || !end || !type || !direction) {
      return {
        statusCode: 400,
        body: "Missing one of required parameters: ean, start, end, type, direction"
      };
    }

    // 2) Connect to MongoDB
    const client = await getClient();
    const coll   = client.db("ikehu").collection("reading_day");

    // 3) Determine which dial prefix to use
    const prefix = direction === "Teruglevering" ? "dial_280" : "dial_180";

    // 4) Parse ISO timestamps
    const startDt = new Date(start);
    const endDt   = new Date(end);

    // 5) Fetch only the 'readings' field for documents matching this EAN
    const docs = await coll
      .find({ "metadata.ean": ean })
      .project({ readings: 1, _id: 0 })
      .toArray();

    // 6) Extract, filter by date, and convert raw values
    let readings = [];
    docs.forEach(doc => {
      const rd = doc.readings[prefix] || {};
      Object.entries(rd).forEach(([ts, raw]) => {
        const dt = new Date(ts);
        if (dt >= startDt && dt < endDt) {
          let val = Number(raw);
          if (type === "Elektriciteit") {
            val /= 1000; // convert Wh to kWh
          }
          readings.push({ datetime: dt.toISOString(), raw: val });
        }
      });
    });

    // 7) Sort chronologically and compute differences between consecutive readings
    readings.sort((a, b) => new Date(a.datetime) - new Date(b.datetime));
    let lastRaw = null;
    const result = readings.map(r => {
      const value = lastRaw === null ? 0 : (r.raw - lastRaw);
      lastRaw = r.raw;
      return { datetime: r.datetime, value };
    });

    // 8) Return the JSON array of { datetime, value }
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(result)
    };

  } catch (err) {
    console.error("getReadings error:", err);
    return {
      statusCode: 500,
      body: "Internal server error"
    };
  }
};
