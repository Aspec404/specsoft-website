
require('dotenv').config();

const express = require('express');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

app.get('/health', (req, res) => {
  res.json({
    status: 'online',
    service: 'SPECSOFT Backend',
  });
});

app.listen(PORT, () => {
  console.log(`SPECSOFT backend running on port ${PORT}`);
});
