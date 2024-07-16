import {
  connect,
  ExtensionTransport,
} from 'puppeteer-core/lib/esm/puppeteer/puppeteer-core-browser.js';

const wrapAsyncFunction = (listener) => (request, sender, sendResponse) => {
  // the listener(...) might return a non-promise result (not an async function), so we wrap it with Promise.resolve()
  Promise.resolve(listener(request, sender)).then(sendResponse);
  return true; // return true to indicate you want to send a response asynchronously
};

chrome.runtime.onMessage.addListener(
  wrapAsyncFunction(async (request, sender) => {
    if (request.command === 'daily-checkin') {
      const url = 'https://www.aliexpress.com/p/coin-pc-index/index.html';
      const tab = await chrome.tabs.create({
        url,
      });

      // Wait for the new tab to load before connecting.
      await new Promise(resolve => {
        function listener(tabId, changeInfo) {
          if (tabId === tab.id && changeInfo.status === 'complete') {
            chrome.tabs.onUpdated.removeListener(listener);
            resolve();
          }
        }
        chrome.tabs.onUpdated.addListener(listener);
      });
      const browser = await connect({
        transport: await ExtensionTransport.connectTab(tab.id),
      });
      const [page] = await browser.pages();
      const [button] = await page.$$('xpath/.//*[@class="checkin-button"]');
      console.log('collect btn:', button);
      if (button) {// can collect
        await button.click();
      } else { // can't collect
        console.log("can't collect, element is not available.");
      }

      await browser.disconnect();
    }
    else if (request.command === 'fetch-mycoin') {
      const url = 'https://www.aliexpress.com/p/coin-pc-index/mycoin.html';
      const tab = await chrome.tabs.create({
        url,
      });

      // Wait for the new tab to load before connecting.
      await new Promise(resolve => {
        function listener(tabId, changeInfo) {
          if (tabId === tab.id && changeInfo.status === 'complete') {
            chrome.tabs.onUpdated.removeListener(listener);
            resolve();
          }
        }
        chrome.tabs.onUpdated.addListener(listener);
      });
      const browser = await connect({
        transport: await ExtensionTransport.connectTab(tab.id),
      });
      const [page] = await browser.pages();
      
      const mycoin = await page.evaluate(() => {
        const e1 = document.querySelector('.coin-info-content-head-text'); //coins
        const e2 = document.querySelector('.coin-info-content-money-num'); //saves
        return {coins: e1.innerHTML, saves: e2.innerHTML};
      });

      console.log("from worker", mycoin);

      // Store coin info in permanent storage
      chrome.storage.local.set({"mycoin": mycoin}, () => {
          if (chrome.runtime.lastError)
            console.log('Error setting');

          console.log('Stored name: ' + mycoin);
      });

      await browser.disconnect();
      return mycoin;
    }

    return null;
  })
);