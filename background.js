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

const wait_for_tab = async (tab) => {
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

/////////////////// functions for setting default extension settings ////////////////////////////

const H2MS = 60 * 60 * 1000;
const M2MS = 60 * 1000;
const WAIT_TIME_BEFORE_COLLECT = 20000;//24*H2MS;//H2MS * 12;
const TIMEOUT_DURS = 1000; /*5*60*1000*/

const DEFAULT_OPTIONS = {
  'user-coins': 0,
  'max-retries': 24,
  'retry-count': 0,
  'retry-delay': 60, // in minutes
  't-last-checkin-attempt': 0,
  't-last-successful-checkin': 0,
  'pc-streak-rate': 20,
  'mobile-streak-rate': 10
};

chrome.storage.sync.get(DEFAULT_OPTIONS, (options) => {
  chrome.storage.sync.set(options);
});

const checkin = async () => {
  const tab = await chrome.tabs.create({
    url: 'https://www.aliexpress.com/p/coin-pc-index/index.html',
  });

  // Wait for the new tab to load before connecting.
  await wait_for_tab(tab);
  const browser = await connect({
    transport: await ExtensionTransport.connectTab(tab.id)
  });
  const [page] = await browser.pages();
  await page.waitForNetworkIdle();
  const [button] = await page.$$('xpath/.//*[@class="checkin-button"]');
  console.log('collect btn:', button);

  const now = Date.now(); // get unix timestamp
  if (button) {
    await button.click();
    await page.waitForNetworkIdle(); // wait until coins are added server-side
    chrome.storage.sync.set({
      't-last-successful-checkin': now,
      't-last-checkin-attempt': now,
      'retry-count': 0, // reset attempts
      });
    const nowDate = new Date(now);
    console.log(`date: ${nowDate.toLocaleDateString()}, time: ${nowDate.toLocaleTimeString()}`);
  } else {
    chrome.storage.sync.set({'t-last-checkin-attempt': now});
    chrome.storage.sync.get(['retry-count']).then((options) => {
      const retries = options['retry-count'];
      console.log(`retries: ${retries}`);
      chrome.storage.sync.set({'retry-count': retries + 1});
    });
    console.log("can't collect, element is not available.");
  }

  // const nextDay = await page.waitForSelector('div.day-card.default.nextday');
  const pcrate = await page.$eval('xpath/.//div[@class="addcoin"]', el => el.innerText);

  console.log(`addcoin: ${pcrate}`);
  chrome.storage.sync.set({'pc-streak-rate': parseInt(pcrate,10)});

  await chrome.tabs.remove(tab.id);
  await browser.disconnect();
}

const update_mycoins = async () => {
  const tab = await chrome.tabs.create({
    url: 'https://www.aliexpress.com/p/coin-pc-index/mycoin.html',
  });
  await wait_for_tab(tab);

  const browser = await connect({
    transport: await ExtensionTransport.connectTab(tab.id)
  });

  const [page] = await browser.pages();
  const coins = await page.$eval('xpath/.//*[@class="coin-info-content-head-text"]', el => el.innerText);
  console.log(coins);

  // Save coins into extension storage
  chrome.storage.sync.set({'user-coins': coins});

  await chrome.tabs.remove(tab.id);
  await browser.disconnect();
};

chrome.runtime.onMessage.addListener(
  wrapAsyncFunction(async (request, sender) => {
    if (request.command === 'request-data') {
      const response = await chrome.storage.sync.get(DEFAULT_OPTIONS).then((result) => {
        console.log('Value is:', result);
        return result;
      });

      return response;
    } else if (request.command === 'daily-checkin') {
      await checkin();
      const response = await update_mycoins();
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

const updateLoop = async () => {
  // get unix timestamp for last collection
  const options = await chrome.storage.sync.get(DEFAULT_OPTIONS);

  const lastTime = options['t-last-successful-checkin'] ?? 0;
  const now = Date.now();

  const elapsedTime = now - lastTime;
  // console.log("Last time:", lastTime);
  // console.log("Now time:", now);
  // console.log("Elapsed time", elapsedTime);
  // console.log("Retries ", options['retry-count']);
  // console.log("Max retries ", options['max-retries']);
  if ((now > lastTime + 24 * H2MS) && (options['retry-count'] < options['max-retries'])) {
    // 24 hours elapsed since last successful collect & we haven't exhausted our tries
    const lastTry = options['t-last-checkin-attempt'] ?? 0;
    const retrydelay = options['retry-delay'] * M2MS; // conver from mins to ms
    // console.log("Last try:", lastTry);
    if (now > lastTry + retrydelay && lastTry>0) {
      await checkin();
      await update_mycoins();
    }
  }
  
  setTimeout(updateLoop, TIMEOUT_DURS);
};

updateLoop();