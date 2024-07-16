const puppeteer = require('puppeteer');
  const browser = await puppeteer.connect({
    browserWSEndpoint: '<another-browser-ws-endpont>'
  });