// netlify/functions/getReadings.js
const { MongoClient } = require("mongodb");

let clientPromise;
async function getClient() {
  if (!clientPromise) {
    clientPromise = MongoClient.connect(
      process.env.MONGO_URI,
      { useNewUrlParser: true, useUnifiedTopology: true }
    );
  }
  return clientPromise;
}

exports.handler = async (event) => {
  try {
    // parse & validate query params
    const { ean, start, end, type, direction } = event.queryStringParameters || {};
    if (!ean || !start || !end || !type || !direction) {
      return { statusCode: 400, body: "Missing ean, start, end, type or direction" };
    }

    const client = await getClient();
    const coll   = client.db("ikehu").collection("reading_day");

    // choose the right prefix
    const prefix = direction === "Teruglevering" ? "dial_280" : "dial_180";
    const startDt = new Date(start);
    const endDt   = new Date(end);

    // fetch all docs for that EAN
    const docs = await coll.find({ "metadata.ean": ean })
                           .project({ readings: 1, _id: 0 })
                           .toArray();

    // extract, filter and diff
    let readings = [];
    docs.forEach(doc => {
      const rd = doc.readings[prefix] || {};
      Object.entries(rd).forEach(([ts, raw]) => {
        const dt = new Date(ts);
        if (dt >= startDt && dt < endDt) {
          let val = Number(raw);
          if (type === "Elektriciteit") val /= 1000;
          readings.push({ datetime: dt.toISOString(), raw: val });
        }
      });
    });

    readings.sort((a,b) => new Date(a.datetime) - new Date(b.datetime));
    let lastRaw = null;
    const result = readings.map(r => {
      const value = lastRaw === null ? 0 : (r.raw - lastRaw);
      lastRaw = r.raw;
      return { datetime: r.datetime, value };
    });

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(result)
    };
  } catch (err) {
    console.error(err);
    return {
      statusCode: 500,
      body: "Internal server error"
    };
  }
};
