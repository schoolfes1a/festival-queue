const express = require('express');
const app = express();

const PORT = 3000;

let currentNumber = 1;
let latestTicket = 0;

app.use(express.static('public'));

app.get('/status', (req, res) => {

    res.json({
        current: currentNumber,
        latest: latestTicket
    });

});

app.get('/next', (req, res) => {

    if (currentNumber < latestTicket) {
        currentNumber++;
    }

    res.json({
        current: currentNumber
    });

});

app.get('/new-ticket', (req, res) => {

    latestTicket++;

    res.json({
        ticket: latestTicket
    });

});

app.listen(PORT, '0.0.0.0', () => {

    console.log(`Server running on port ${PORT}`);

});