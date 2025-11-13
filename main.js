// SISKA AI Final Backend (ver3)
// Pure JavaScript version for Deno Deploy

import { serve } from "https://deno.land/std@0.140.0/http/server.ts";

// Muat environment variables
const API_KEYS = {
    FOURSQUARE: Deno.env.get("FOURSQUARE_KEY") || "",
    OPENWEATHER: Deno.env.get("OPENWEATHER_KEY") || "",
    AQI: Deno.env.get("AQI_TOKEN") || "",
    RAJAONGKIR_SHIPPING: Deno.env.get("RAJAONGKIR_SHIPPING_KEY") || "",
    FRONTEND_URL: Deno.env.get("FRONTEND_URL") || "*",
};

// Database ID Kota untuk RajaOngkir
const KOTA_DB = {
    'jakarta': '152', 'jkt': '152',
    'bandung': '23', 'bdg': '23',
    'surabaya': '444', 'sby': '444',
    'semarang': '399', 'smg': '399',
    'yogyakarta': '573', 'jogja': '573',
    'medan': '222',
    'makassar': '196',
    'palembang': '320',
    'denpasar': '114', 'bali': '114',
};

function parseOngkirRequest(message) {
    const lower = message.toLowerCase();
    
    let origin = 'jakarta';
    let destination = 'surabaya';
    let weight = 1000;

    const weightMatch = lower.match(/(\d+)\s*(kg|gram|g)/);
    if (weightMatch) {
        const num = parseInt(weightMatch[1]);
        if (weightMatch[2] === 'kg') {
            weight = num * 1000;
        } else {
            weight = num;
        }
    }

    const routeMatch = lower.match(/(?:dari\s)?([a-zA-Z]+)\s(?:ke|ke\s|-)\s([a-zA-Z]+)/);
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

// ... (semua fungsi lainnya sama seperti di TypeScript version, tapi tanpa type annotations)

async function handler(req) {
    const allowedOrigin = API_KEYS.FRONTEND_URL;

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

    if (req.method !== "POST") {
        return new Response(JSON.stringify({ error: "Method not allowed" }), { 
            status: 405, 
            headers: { 
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": allowedOrigin,
            } 
        });
    }

    let responseText = "Maaf, terjadi kesalahan pada server proxy.";
    let status = 500;

    try {
        const { intent, location, message } = await req.json();

        switch (intent) {
            case 'prayer':
                const prayerData = await fetchPrayerTimes(location?.lat, location?.lon);
                responseText = generatePrayerOutput(prayerData, message.toLowerCase());
                break;
            
            case 'weather':
                const { weather, aqi } = await fetchWeatherAndAqi(location?.lat, location?.lon);
                responseText = generateWeatherOutput(weather, aqi);
                break;

            case 'kuliner':
            case 'wisata':
            case 'masjid':
                const placesData = await fetchFoursquarePlaces(location?.lat, location?.lon, intent);
                responseText = generateFoursquareOutput(placesData, intent);
                break;

            case 'ongkir':
                const { origin, destination, weight } = parseOngkirRequest(message);
                const ongkirData = await fetchRajaOngkir(origin, destination, weight);
                responseText = generateOngkirOutput(ongkirData, origin, destination, weight);
                break;

            default:
                responseText = "Niat (intent) tidak dikenali oleh server proxy.";
                status = 400;
        }
        status = 200;
    } catch (error) {
        console.error("Server Handler Error:", error);
        responseText = `Terjadi kesalahan internal pada server: ${error.message}`;
    }

    return new Response(JSON.stringify({ responseText }), {
        status,
        headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": allowedOrigin,
        },
    });
}

const port = parseInt(Deno.env.get("PORT") || "8000");

console.log(`🚀 Starting SISKA Proxy Server (ver3) ...`);
console.log(`🌐 Server is starting and listening on port ${port}...`);

serve(handler, { port });
