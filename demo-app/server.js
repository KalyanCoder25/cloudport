const express = require('express');
const app = express();
const port = process.env.PORT || 8080;

app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

app.get('/', (req, res) => {
  res.send(`<h1>Hello from CloudPort Demo!</h1><p>Running on port ${port}</p>`);
});

app.listen(port, () => {
  console.log(`Demo app listening on port ${port}`);
});
