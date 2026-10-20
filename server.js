
require('dotenv').config();

const express = require('express');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Serve the website pages and their assets from the project root. Keep this
// after API routes so the backend endpoints remain available.
app.use(express.static(__dirname, { index: 'index.html' }));

app.get('/health', (req, res) => {
  res.json({
    status: 'online',
    service: 'SPECSOFT Backend',
  });
});

app.listen(PORT, () => {
  console.log(`SPECSOFT backend running on port ${PORT}`);
});
