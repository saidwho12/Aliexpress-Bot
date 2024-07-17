import {
  connect,
  ExtensionTransport,
} from 'puppeteer-core/lib/esm/puppeteer/puppeteer-core-browser.js';

const wrapAsyncFunction = (listener) => (request, sender, sendResponse) => {
  // the listener(...) might return a non-promise result (not an async function), so we wrap it with Promise.resolve()
  Promise.resolve(listener(request, sender)).then(sendResponse);
  return true; // return true to indicate you want to send a response asynchronously
};

const getRandomDelay = (min, max) => {
  return Math.floor(Math.random() * (max - min + 1)) + min;
};

const waitForTab = async (tab) => {
  await new Promise(resolve => {
    const listener = (tabId, changeInfo) => {
      if (tabId === tab.id && changeInfo.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
  });
};

chrome.storage.onChanged.addListener((changes, namespace) => {
  for (let [key, { oldValue, newValue }] of Object.entries(changes)) {
    console.log(
      `Storage key "${key}" in namespace "${namespace}" changed.`,
      `Old value was "${oldValue}", new value is "${newValue}".`
    );
  }
});

const checkin = async () => {
  const tab = await chrome.tabs.create({
    url: 'https://www.aliexpress.com/p/coin-pc-index/index.html',
  });

  // Wait for the new tab to load before connecting.
  await waitForTab(tab);
  const browser = await connect({
    transport: await ExtensionTransport.connectTab(tab.id)
  });
  const [page] = await browser.pages();
  const button = await page.$('xpath/.//*[@class="checkin-button"]//*[contains(.,"Collect")]');
  console.log('collect btn:', button);
  if (button) {
    await button.click();
  } else {
    console.log("can't collect, element is not available.");
  }

  const now = Date.now();
  chrome.storage.sync.set({'last-collected-time': now}); // set unix timestamp
  const nowDate = new Date(now);
  const date = nowDate.toLocaleDateString();
  const time = nowDate.toLocaleTimeString();
  console.log('date:', date, ", time:", time);

  await chrome.tabs.remove(tab.id);
  await browser.disconnect();
}

const gather_coins_data = async () => {
  const tab = await chrome.tabs.create({
    url: 'https://www.aliexpress.com/p/coin-pc-index/mycoin.html',
  });
  await waitForTab(tab);

  const browser = await connect({
    transport: await ExtensionTransport.connectTab(tab.id)
  });

  const [page] = await browser.pages();

  const coins = await page.$eval('xpath/.//*[@class="coin-info-content-head-text"]', el => el.innerHTML);
  const savings = await page.$eval('xpath/.//*[@class="coin-info-content-money-num"]', el => el.innerHTML);

  console.log(coins, savings);

  // Save coins and savings into extension storage
  const result = {'user-coins': coins, 'user-savings': savings};
  chrome.storage.sync.set(result);

  await chrome.tabs.remove(tab.id);
  await browser.disconnect();

  return result;
};

chrome.runtime.onMessage.addListener(
  wrapAsyncFunction(async (request, sender) => {
    if (request.command === 'request-data') {
      const response = await chrome.storage.sync.get(['user-coins', 'user-savings']).then((result) => {
        console.log('Value is:', result);
        return result;
      });

      return response;
    } else if (request.command === 'daily-checkin') {
      await checkin();
      const response = await gather_coins_data();
      return response;
      // const [newPage] = browser.newPage();
      // Now that we collected the coins, we can save our coin information
      // await page.goto('https://www.aliexpress.com/p/coin-pc-index/mycoin.html', {
      //   waitUntil: 'networkidle0', timeout: 0
      // });

      // await page.waitForTimeout(getRandomDelay(500,1500));
      // await page.click('.mycoin-box');
      // await page.waitForNavigation({
      //   waitUntil: 'networkidle0',
      // });
    }
    else if (request.command === 'fetch-mycoin') {
      const response = await fetch('https://www.aliexpress.com/p/coin-pc-index/mycoin.html', {
        method: 'GET',
        mode: 'cors',
        credentials: 'include'
      });
      console.log(response);

      // When the page is loaded convert it to text
      const html = response.text()
      console.log(html);
  
      // // Initialize the DOM parser
      // const dom = new jsdom.JSDOM(html);

      // console.log(html);

      // const tab = await chrome.tabs.create({
      //   url,
      // });

      // // Wait for the new tab to load before connecting.
      // await new Promise(resolve => {
      //   function listener(tabId, changeInfo) {
      //     if (tabId === tab.id && changeInfo.status === 'complete') {
      //       chrome.tabs.onUpdated.removeListener(listener);
      //       resolve();
      //     }
      //   }
      //   chrome.tabs.onUpdated.addListener(listener);
      // });
      // const browser = await connect({
      //   transport: await ExtensionTransport.connectTab(tab.id)
      // });
      // const [page] = await browser.pages();
      
      // const mycoin = await page.evaluate(() => {
      //   const e1 = document.querySelector('.coin-info-content-head-text'); //coins
      //   const e2 = document.querySelector('.coin-info-content-money-num'); //saves
      //   return {coins: e1.innerHTML, saves: e2.innerHTML};
      // });

      // console.log("from worker", mycoin);

      // // Store coin info in permanent storage
      // chrome.storage.local.set({"mycoin": mycoin}, () => {
      //     if (chrome.runtime.lastError)
      //       console.log('Error setting');

      //     console.log('Stored name: ' + mycoin);
      // });

      // await browser.disconnect();
      return {};
    }

    return null;
  })
);