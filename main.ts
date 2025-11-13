// SISKA AI Final Backend (ver3)
// TypeScript version for Deno Deploy

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
const KOTA_DB: { [key: string]: string } = {
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

// ====================================================================
// ==================== FUNGSI HELPER API =============================
// ====================================================================

function parseOngkirRequest(message: string) {
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

async function fetchRajaOngkir(originName: string, destName: string, weightGrams: number) {
    const originId = KOTA_DB[originName.toLowerCase()];
    const destId = KOTA_DB[destName.toLowerCase()];

    if (!originId || !destId) {
        return { 
            error: `Maaf, saya belum mengenali kota "${originId ? destName : originName}". Database kota saya masih terbatas.` 
        };
    }
    
    if (!API_KEYS.RAJAONGKIR_SHIPPING) {
        return { error: "API Key RajaOngkir tidak disetel di server." };
    }

    try {
        const response = await fetch("https://api.rajaongkir.com/starter/cost", {
            method: 'POST',
            headers: {
                'key': API_KEYS.RAJAONGKIR_SHIPPING,
                'content-type': 'application/json'
            },
            body: JSON.stringify({
                origin: originId,
                destination: destId,
                weight: weightGrams,
                courier: "jne:tiki:sicepat"
            })
        });

        if (!response.ok) {
            const errData = await response.json();
            console.error("RajaOngkir API Error:", errData);
            return { error: `API RajaOngkir error: ${errData.rajaongkir?.status?.description || 'Unknown error'}` };
        }
        
        const data = await response.json();
        return data.rajaongkir;

    } catch (error) {
        console.error("Error fetching RajaOngkir:", error);
        return { error: `Gagal terhubung ke API RajaOngkir: ${error.message}` };
    }
}

async function fetchPrayerTimes(lat: number, lon: number) {
    if (!lat || !lon) return null;
    try {
        const response = await fetch(`https://api.aladhan.com/v1/timings?latitude=${lat}&longitude=${lon}&method=20&school=1`); 
        if (!response.ok) throw new Error("Al-Adhan API request failed");
        const data = await response.json();
        const timings = data.data.timings;
        const location = data.data.meta.timezone; 
        const date = data.data.date.readable;
        return {
            city: location.split('/').pop().replace('_', ' '),
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

async function fetchWeatherAndAqi(lat: number, lon: number) {
    if (!lat || !lon) return { weather: null, aqi: null };
    let weatherData = null, aqiData = null;
    try {
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

async function fetchFoursquarePlaces(lat: number, lon: number, intent: string) {
    if (!lat || !lon || !API_KEYS.FOURSQUARE) {
        console.error("Foursquare API key or location missing");
        return null;
    }
    const categories: { [key: string]: string } = { 
        'kuliner': '13065', 
        'wisata': '19000', 
        'masjid': '12048' 
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
        return data.results.map((place: any) => ({
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
// ==================== FUNGSI FORMATTER ==============================
// ====================================================================

function generateOngkirOutput(data: any, origin: string, dest: string, weight: number) {
    if (data.error) {
        return data.error;
    }

    const { query, results } = data;
    const originCity = query.origin_details.city_name;
    const destCity = query.destination_details.city_name;
    const weightKg = weight / 1000;

    let responseText = `Tentu! Berikut hasil cek ongkir **${originCity}** ke **${destCity}** (${weightKg} kg) dari API RajaOngkir (Live):\n\n`;

    if (!results || results.length === 0 || !results[0].costs || results[0].costs.length === 0) {
        return `Maaf, tidak ditemukan layanan kurir untuk rute ${originCity} ke ${destCity}.`;
    }

    let allServices: any[] = [];
    results.forEach((courier: any) => {
        courier.costs.forEach((cost: any) => {
            allServices.push({
                courier: courier.code.toUpperCase(),
                service: cost.service,
                description: cost.description,
                cost: cost.cost[0].value,
                etd: cost.cost[0].etd.replace(' HARI', '')
            });
        });
    });

    if (allServices.length === 0) {
        return `Maaf, tidak ditemukan layanan untuk rute ${originCity} ke ${destCity}.`;
    }

    allServices.sort((a, b) => a.cost - b.cost);

    allServices.forEach(item => {
        responseText += `• **${item.courier} (${item.service})**: Rp ${item.cost.toLocaleString('id-ID')} (Est. ${item.etd} hari)\n`;
    });
    
    return responseText;
}

function generatePrayerOutput(data: any, intent: string) {
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
        responseText += `• Subuh: **${data.subuh}**\n• Dzuhur: **${data.dzuhur}**\n• Ashar: **${data.ashar}**\n• Maghrib: **${data.maghrib}**\n• Isya: **${data.isya}**\n`;
    }
    return responseText;
}

function generateWeatherOutput(weather: any, aqi: any) {
    if (!weather) return "Maaf, saya gagal mengambil data cuaca untuk lokasi Anda. Pastikan GPS aktif dan coba lagi.";
    let sapaan = 'Tentu';
    let aqiRecommendation = "Data kualitas udara (AQI) tidak tersedia untuk lokasi ini.";
    if (aqi) {
        aqiRecommendation = aqi.aqi > 100 ? 
            `Kualitas udara (${aqi.aqi}) **${aqi.aqi_level}**. Sebaiknya kurangi aktivitas di luar ruangan atau gunakan masker.` : 
            `Kualitas udara (${aqi.aqi}) **Baik**. Aman untuk beraktivitas di luar.`;
    }
    return `${sapaan}! Berdasarkan lokasi Anda di **${weather.city}** (dari API OpenWeather/AQI Live):\n\n• **Cuaca**: ${weather.temp}°C, ${weather.condition}\n• **Kelembapan**: ${weather.humidity}%\n• **Angin**: ${weather.wind} m/s\n\n${aqiRecommendation}`;
}

function generateFoursquareOutput(data: any, intent: string) {
    if (!data || data.length === 0) return `Maaf, saya tidak menemukan ${intent} terdekat di lokasi Anda saat ini. (Live Foursquare)`;
    let sapaan = 'Tentu';
    let title = "tempat";
    if (intent === 'kuliner') title = 'kuliner';
    if (intent === 'wisata') title = 'wisata';
    if (intent === 'masjid') title = 'masjid';
    let responseText = `${sapaan}! Berikut 5 rekomendasi **${title} terdekat** dari lokasi Anda (Data Live Foursquare):\n\n`;
    data.forEach((item: any) => {
        responseText += `• **${item.name}** (~${item.distance}m)\n  *${item.type} | ${item.address}*\n`;
    });
    return responseText;
}

// ====================================================================
// ==================== MAIN SERVER HANDLER ===========================
// ====================================================================

async function handler(req: Request) {
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

// ====================================================================
// ==================== SERVER STARTUP ================================
// ====================================================================

const port = parseInt(Deno.env.get("PORT") || "8000");

console.log(`🚀 Starting SISKA Proxy Server (ver3) ...`);

console.log("📊 API Keys Status:");
console.log(`- FOURSQUARE: ${API_KEYS.FOURSQUARE ? '✅ Loaded' : '❌ Missing'}`);
console.log(`- OPENWEATHER: ${API_KEYS.OPENWEATHER ? '✅ Loaded' : '❌ Missing'}`);
console.log(`- AQI: ${API_KEYS.AQI ? '✅ Loaded' : '❌ Missing'}`);
console.log(`- RAJAONGKIR: ${API_KEYS.RAJAONGKIR_SHIPPING ? '✅ Loaded' : '❌ Missing'}`);
console.log(`- FRONTEND_URL: ${API_KEYS.FRONTEND_URL !== "*" ? '✅ ' + API_KEYS.FRONTEND_URL : '❌ Not Set (Using *)'}`);

console.log(`🌐 Server is starting and listening on port ${port}...`);

serve(handler, { port });
