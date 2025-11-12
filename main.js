import { serve } from "https://deno.land/std@0.140.0/http/server.ts";
import { config } from "https://deno.land/x/dotenv/mod.ts";

// Muat semua API keys dari file .env (atau environment hosting)
// Deno Deploy akan menggunakan "Environment Variables" / "Secrets"
config({ export: true });

const API_KEYS = {
    FOURSQUARE: Deno.env.get("FOURSQUARE_KEY") || "CTHCI3SKCEOMVG5MQWFYWJ2UAPNJHHDLR35LRMCZ05T523US",
    OPENWEATHER: Deno.env.get("OPENWEATHER_KEY") || "aac5982dd726344b02bfe424680233af",
    AQI: Deno.env.get("AQI_TOKEN") || "64f0ff6a81f283f53fcde3a53625d3c0f62419c4",
    RAJAONGKIR_SHIPPING: Deno.env.get("RAJAONGKIR_SHIPPING_KEY") || "v7KmmHhX36acee7257c631283zHzbifA",
    // Tambahkan kunci lain (misal: OPENROUTE, GOAPI) di sini jika ingin diimplementasikan di ver2
};

// ====================================================================
// ==================== FUNGSI HELPER API (ACTION LAYER) =================
// ====================================================================

/**
 * Mengambil data Jadwal Sholat LIVE dari Al-Adhan
 * Menggunakan koordinat GPS pengguna.
 */
async function fetchPrayerTimes(lat, lon) {
    if (!lat || !lon) return null;
    try {
        // OPTIMALISASI: Menggunakan method 20 (Kemenag RI) & school 1 (Shafi'i)
        const response = await fetch(`https://api.aladhan.com/v1/timings?latitude=${lat}&longitude=${lon}&method=20&school=1`); 
        if (!response.ok) throw new Error("Al-Adhan API request failed");
        const data = await response.json();
        
        // Ekstrak data yang relevan
        const timings = data.data.timings;
        const location = data.data.meta.timezone; // Mendapatkan lokasi/zona waktu
        const date = data.data.date.readable;

        return {
            city: location.split('/').pop().replace('_', ' '), // "Jakarta"
            date: date,
            subuh: timings.Fajr,
            dzuhur: timings.Dhuhr,
            ashar: timings.Asr,
            maghrib: timings.Maghrib,
            isya: timings.Isha
        };
    } catch (error) {
        console.error("Error fetching prayer times:", error.message);
        return null;
    }
}

/**
 * Mengambil data Cuaca & AQI LIVE
 */
async function fetchWeatherAndAqi(lat, lon) {
    if (!lat || !lon) return { weather: null, aqi: null };
    
    let weatherData = null;
    let aqiData = null;

    try {
        // 1. Ambil Cuaca (OpenWeather)
        const weatherResponse = await fetch(`https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${API_KEYS.OPENWEATHER}&units=metric&lang=id`);
        if (weatherResponse.ok) {
            const data = await weatherResponse.json();
            weatherData = {
                city: data.name,
                temp: Math.round(data.main.temp),
                condition: data.weather[0] ? data.weather[0].description : "Cerah",
                humidity: data.main.humidity,
                wind: data.wind.speed
            };
        } else {
            console.warn("OpenWeather API request failed:", weatherResponse.statusText);
        }
    } catch (error) {
        console.error("Error fetching weather:", error.message);
    }

    try {
        // 2. Ambil AQI (World's Air Quality Index)
        const aqiResponse = await fetch(`https://api.waqi.info/feed/geo:${lat};${lon}/?token=${API_KEYS.AQI}`);
        if (aqiResponse.ok) {
            const data = await aqiResponse.json();
            if (data.status === "ok") {
                const aqi = data.data.aqi;
                let level = "Baik";
                if (aqi > 150) level = "Tidak Sehat";
                else if (aqi > 100) level = "Tidak Sehat bagi Kelompok Sensitif";
                else if (aqi > 50) level = "Sedang";
                
                aqiData = {
                    aqi: aqi,
                    aqi_level: level,
                    pollutant: data.data.dominantPollutant || "PM2.5"
                };
            }
        } else {
             console.warn("AQI API request failed:", aqiResponse.statusText);
        }
    } catch (error) {
        console.error("Error fetching AQI:", error.message);
    }
    
    return { weather: weatherData, aqi: aqiData };
}

/**
 * Mengambil data POI (Kuliner/Wisata/Masjid) LIVE dari Foursquare
 */
async function fetchFoursquarePlaces(lat, lon, intent) {
    if (!lat || !lon || !API_KEYS.FOURSQUARE) {
        console.error("Foursquare API key or location missing");
        return null;
    }

    // Tentukan kategori berdasarkan niat (Intent)
    const categories = {
        'kuliner': '13065', // Restoran
        'wisata': '19000',  // Seni & Hiburan
        'masjid': '12048'   // Masjid
    };
    
    const category = categories[intent];
    if (!category) return null;

    const options = {
        method: 'GET',
        headers: {
            accept: 'application/json',
            Authorization: API_KEYS.FOURSQUARE
        }
    };
    
    try {
        const response = await fetch(`https://api.foursquare.com/v3/places/search?ll=${lat}%2C${lon}&categories=${category}&limit=5&sort=DISTANCE`, options);
        if (!response.ok) {
            console.error("Foursquare API Error Body:", await response.text());
            throw new Error(`Foursquare API request failed: ${response.statusText}`);
        }
        
        const data = await response.json();
        
        return data.results.map(place => ({
            name: place.name,
            distance: place.distance,
            address: place.location.formatted_address || "Alamat tidak tersedia",
            type: place.categories[0] ? place.categories[0].name : "Tempat"
        }));

    } catch (error) {
        console.error("Error fetching Foursquare:", error.message);
        return null;
    }
}

// ====================================================================
// ==================== FUNGSI FORMATTER (RESPONSE LAYER) ==============
// ====================================================================

function generatePrayerOutput(data, intent) {
    if (!data) return "Maaf, saya gagal mengambil jadwal sholat untuk lokasi Anda. Pastikan GPS aktif dan coba lagi.";

    let sapaan = 'Tentu';
    let responseText = `${sapaan}! Berikut jadwal sholat untuk **${data.city}** hari ini (${data.date}) dari API Al-Adhan (Live):\n\n`;

    const prayerMap = {
        "subuh": data.subuh,
        "dzuhur": data.dzuhur,
        "ashar": data.ashar,
        "maghrib": data.maghrib,
        "isya": data.isya
    };

    let specificPrayerFound = false;
    for (const key in prayerMap) {
        if (intent.includes(key)) {
            responseText = `${sapaan}, waktu **${key}** untuk **${data.city}** hari ini adalah pukul **${prayerMap[key]}**. (Data Live)`;
            specificPrayerFound = true;
            break;
        }
    }

    if (!specificPrayerFound) {
        responseText += `• Subuh: **${data.subuh}**\n`;
        responseText += `• Dzuhur: **${data.dzuhur}**\n`;
        responseText += `• Ashar: **${data.ashar}**\n`;
        responseText += `• Maghrib: **${data.maghrib}**\n`;
        responseText += `• Isya: **${data.isya}**\n`;
    }
    
    return responseText;
}

function generateWeatherOutput(weather, aqi) {
    if (!weather) return "Maaf, saya gagal mengambil data cuaca untuk lokasi Anda. Pastikan GPS aktif dan coba lagi.";

    let sapaan = 'Tentu';
    let aqiRecommendation = "Data kualitas udara (AQI) tidak tersedia untuk lokasi ini.";
    
    if (aqi) {
        aqiRecommendation = aqi.aqi > 100 ? 
            `Kualitas udara (${aqi.aqi}) **${aqi.aqi_level}**. Sebaiknya kurangi aktivitas di luar ruangan atau gunakan masker.` : 
            `Kualitas udara (${aqi.aqi}) **Baik**. Aman untuk beraktivitas di luar.`;
    }

    return `
${sapaan}! Berdasarkan lokasi Anda di **${weather.city}** (dari API OpenWeather/AQI Live):\n
• **Cuaca**: ${weather.temp}°C, ${weather.condition}
• **Kelembapan**: ${weather.humidity}%
• **Angin**: ${weather.wind} m/s\n
${aqiRecommendation}
    `;
}

function generateFoursquareOutput(data, intent) {
    if (!data || data.length === 0) return `Maaf, saya tidak menemukan ${intent} terdekat di lokasi Anda saat ini. (Live Foursquare)`;

    let sapaan = 'Tentu';
    let title = "tempat";
    if (intent === 'kuliner') title = 'kuliner';
    if (intent === 'wisata') title = 'wisata';
    if (intent === 'masjid') title = 'masjid';

    let responseText = `${sapaan}! Berikut 5 rekomendasi **${title} terdekat** dari lokasi Anda (Data Live Foursquare):\n\n`;
    
    data.forEach(item => {
        responseText += `• **${item.name}** (~${item.distance}m)\n  *${item.type} | ${item.address}*\n`;
    });
    
    return responseText;
}

// ====================================================================
// ==================== MAIN SERVER HANDLER ===========================
// ====================================================================

async function handler(req) {
    // OPTIMALISASI KEAMANAN: Dapatkan URL frontend Anda dari environment variables
    // Ini akan digunakan untuk mengunci CORS agar hanya domain Anda yang diizinkan
    const allowedOrigin = Deno.env.get("FRONTEND_URL") || "*";

    // Menangani CORS preflight (OPTIONS)
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

    // Hanya izinkan metode POST
    if (req.method !== "POST") {
        return new Response(JSON.stringify({ error: "Method not allowed" }), {
            status: 405,
            headers: { "Content-Type": "application/json" },
        });
    }

    let responseText = "Maaf, terjadi kesalahan pada server proxy.";
    let status = 500;

    try {
        const { intent, location, message } = await req.json();

        // LOGIKA KONDISIONAL (ALGORITMA PRIORITAS API)
        switch (intent) {
            case 'prayer':
                const prayerData = await fetchPrayerTimes(location.lat, location.lon);
                responseText = generatePrayerOutput(prayerData, message.toLowerCase());
                break;
            
            case 'weather':
                const { weather, aqi } = await fetchWeatherAndAqi(location.lat, location.lon);
                responseText = generateWeatherOutput(weather, aqi);
                break;

            case 'kuliner':
            case 'wisata':
            case 'masjid':
                const placesData = await fetchFoursquarePlaces(location.lat, location.lon, intent);
                responseText = generateFoursquareOutput(placesData, intent);
                break;

            // TODO (ver2): Tambahkan case untuk 'ongkir' (RajaOngkir)
            // case 'ongkir':
            //     ...
            //     break;

            default:
                responseText = "Niat (intent) tidak dikenali oleh server proxy.";
                status = 400;
        }
        
        status = 200;

    } catch (error) {
        console.error("Server Handler Error:", error.message);
        responseText = `Terjadi kesalahan internal pada server: ${error.message}`;
    }

    // Mengirimkan respons kembali ke Frontend
    return new Response(JSON.stringify({ responseText: responseText }), {
        status: status,
        headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": allowedOrigin, // Menerapkan CORS yang lebih aman
        },
    });
}

console.log("Starting SISKA Proxy Server (ver1) on http://localhost:8000 ...");
console.log("API Keys Loaded (Status):");
console.log(`- FOURSQUARE: ${API_KEYS.FOURSQUARE.includes('CTHCI') ? 'Loaded (Default)' : 'Loaded (Env)'}`);
console.log(`- OPENWEATHER: ${API_KEYS.OPENWEATHER.includes('aac59') ? 'Loaded (Default)' : 'Loaded (Env)'}`);
console.log(`- AQI: ${API_KEYS.AQI.includes('64f0f') ? 'Loaded (Default)' : 'Loaded (Env)'}`);
console.log(`- RAJAONGKIR: ${API_KEYS.RAJAONGKIR_SHIPPING.includes('v7Kmm') ? 'Loaded (Default)' : 'Loaded (Env)'}`);
console.log(`- OPTIMALISASI: FRONTEND_URL: ${Deno.env.get("FRONTEND_URL") || 'Not Set (Using *)'}`);


serve(handler, { port: 8000 });