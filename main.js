// SISKA AI Final Backend (ver3.1 Stable for Deno Deploy)
// ✅ Auto-adaptive: Jalan di lokal maupun di Deno Deploy
// ✅ Fix: port dinamis & auto-serve tanpa error Warm Up
// ✅ Fix: RajaOngkir Live + Analytic Thinking Parsing
// ✅ Secure: Environment keys diambil dari variabel Deno Deploy

import { serve } from "https://deno.land/std@0.140.0/http/server.ts";
import { config } from "https://deno.land/x/dotenv/mod.ts";

config({ export: true });

// ==================== API KEYS ====================
const API_KEYS = {
  FOURSQUARE: Deno.env.get("FOURSQUARE_KEY") || "",
  OPENWEATHER: Deno.env.get("OPENWEATHER_KEY") || "",
  AQI: Deno.env.get("AQI_TOKEN") || "",
  RAJAONGKIR_SHIPPING: Deno.env.get("RAJAONGKIR_SHIPPING_KEY") || "",
};

// ==================== SHORT MEMORY: Kota ====================
const KOTA_DB: Record<string, string> = {
  jakarta: "152", jkt: "152",
  bandung: "23", bdg: "23",
  surabaya: "444", sby: "444",
  semarang: "399", smg: "399",
  yogyakarta: "573", jogja: "573",
  medan: "222",
  makassar: "196",
  palembang: "320",
  denpasar: "114", bali: "114",
};

// ==================== PARSER ONGKIR ====================
function parseOngkirRequest(message: string) {
  const lower = message.toLowerCase();
  let origin = "jakarta";
  let destination = "surabaya";
  let weight = 1000;

  const weightMatch = lower.match(/(\d+)\s*(kg|gram|g)/);
  if (weightMatch) {
    const num = parseInt(weightMatch[1]);
    weight = weightMatch[2] === "kg" ? num * 1000 : num;
  }

  const routeMatch = lower.match(/(?:dari\s)?([a-zA-Z]+)\s(?:ke|-)\s([a-zA-Z]+)/);
  if (routeMatch) {
    origin = routeMatch[1];
    destination = routeMatch[2];
  } else {
    const simpleMatch = lower.match(/ongkir\s([a-zA-Z]+)\s([a-zA-Z]+)/);
    if (simpleMatch) {
      origin = simpleMatch[1];
      destination = simpleMatch[2];
    }
  }

  return { origin, destination, weight };
}

// ==================== FETCH RAJAONGKIR ====================
async function fetchRajaOngkir(originName: string, destName: string, weight: number) {
  const originId = KOTA_DB[originName.toLowerCase()];
  const destId = KOTA_DB[destName.toLowerCase()];

  if (!originId || !destId) {
    return { error: `Maaf, saya belum mengenali kota "${originId ? destName : originName}".` };
  }

  try {
    const response = await fetch("https://api.rajaongkir.com/starter/cost", {
      method: "POST",
      headers: {
        key: API_KEYS.RAJAONGKIR_SHIPPING,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        origin: originId,
        destination: destId,
        weight,
        courier: "jne:tiki:sicepat",
      }),
    });

    const data = await response.json();
    return data.rajaongkir;
  } catch (err) {
    console.error(err);
    return { error: err.message };
  }
}

// ==================== FETCH API LAIN ====================
async function fetchPrayerTimes(lat: number, lon: number) {
  const res = await fetch(`https://api.aladhan.com/v1/timings?latitude=${lat}&longitude=${lon}&method=20`);
  const data = await res.json();
  return data.data;
}

async function fetchWeatherAndAqi(lat: number, lon: number) {
  const w = await fetch(`https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${API_KEYS.OPENWEATHER}&units=metric&lang=id`);
  const weather = w.ok ? await w.json() : null;

  const a = await fetch(`https://api.waqi.info/feed/geo:${lat};${lon}/?token=${API_KEYS.AQI}`);
  const aqiData = a.ok ? await a.json() : null;

  return { weather, aqi: aqiData };
}

async function fetchFoursquarePlaces(lat: number, lon: number, intent: string) {
  const categories: Record<string, string> = { kuliner: "13065", wisata: "19000", masjid: "12048" };
  const category = categories[intent];
  const res = await fetch(
    `https://api.foursquare.com/v3/places/search?ll=${lat}%2C${lon}&categories=${category}&limit=5&sort=DISTANCE`,
    { headers: { Authorization: API_KEYS.FOURSQUARE } }
  );
  return res.ok ? await res.json() : null;
}

// ==================== RESPONSE FORMATTER ====================
function generateOngkirOutput(data: any, origin: string, dest: string, weight: number) {
  if (data.error) return data.error;
  const { query, results } = data;
  if (!results) return "Tidak ada hasil dari RajaOngkir.";

  const originCity = query.origin_details.city_name;
  const destCity = query.destination_details.city_name;
  let text = `Cek ongkir dari **${originCity}** ke **${destCity}** (${weight / 1000} kg):\n\n`;
  results.forEach((c: any) => {
    c.costs.forEach((cost: any) => {
      text += `• **${c.code.toUpperCase()} (${cost.service})** Rp ${cost.cost[0].value.toLocaleString("id-ID")} (Est. ${cost.cost[0].etd} hari)\n`;
    });
  });
  return text;
}

// ==================== HANDLER ====================
async function handler(req: Request) {
  const allowedOrigin = Deno.env.get("FRONTEND_URL") || "*";

  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": allowedOrigin,
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      },
    });
  }

  if (req.method !== "POST")
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });

  try {
    const { intent, location, message } = await req.json();
    let responseText = "Niat tidak dikenali.";

    switch (intent) {
      case "weather":
        const { weather, aqi } = await fetchWeatherAndAqi(location.lat, location.lon);
        responseText = `Lokasi: ${weather.name}, Suhu: ${weather.main.temp}°C, AQI: ${aqi.data.aqi}`;
        break;
      case "prayer":
        const prayer = await fetchPrayerTimes(location.lat, location.lon);
        responseText = `Subuh: ${prayer.timings.Fajr}, Dzuhur: ${prayer.timings.Dhuhr}, Maghrib: ${prayer.timings.Maghrib}`;
        break;
      case "kuliner":
      case "wisata":
      case "masjid":
        const places = await fetchFoursquarePlaces(location.lat, location.lon, intent);
        responseText = `Top 5 ${intent} terdekat:\n` + places.results.map((p: any) => `• ${p.name} (${p.distance}m)`).join("\n");
        break;
      case "ongkir":
        const { origin, destination, weight } = parseOngkirRequest(message);
        const ongkirData = await fetchRajaOngkir(origin, destination, weight);
        responseText = generateOngkirOutput(ongkirData, origin, destination, weight);
        break;
    }

    return new Response(JSON.stringify({ responseText }), {
      headers: {
        "Access-Control-Allow-Origin": allowedOrigin,
        "Content-Type": "application/json",
      },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

// ==================== SERVE ====================
if (Deno.env.get("DENO_DEPLOYMENT_ID")) {
  console.log("Running on Deno Deploy...");
  serve(handler);
} else {
  const port = 8000;
  console.log(`Running locally on http://localhost:${port}`);
  serve(handler, { port });
}
