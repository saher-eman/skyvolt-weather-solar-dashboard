require('dotenv').config();
const express = require('express');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.WEATHER_API_KEY;

app.get('/weather', async (req, res) => {
  const city = req.query.city;

  if (!city) {
    return res.status(400).json({
      error: 'City ka naam likho! Example: /weather?city=Karachi'
    });
  }

  try {
    const response = await axios.get(
      'https://api.openweathermap.org/data/2.5/weather',
      {
        params: {
          q: city,
          appid: API_KEY,
          units: 'metric'
        }
      }
    );

    const d = response.data;

    res.json({
      city: d.name,
      country: d.sys.country,
      temperature: d.main.temp + '°C',
      feels_like: d.main.feels_like + '°C',
      humidity: d.main.humidity + '%',
      weather: d.weather[0].description
    });

  } catch (error) {
    if (error.response) {
      res.status(404).json({ error: 'City nahi mili — naam check karo' });
    } else {
      res.status(500).json({ error: 'Server problem — baad mein try karo' });
    }
  }
});

app.listen(PORT, () => {
  console.log('Server chal raha hai port ' + PORT + ' pe!');
});