$('#login-btn').click(async () => {
  console.log('Send message');
  const response = await chrome.runtime.sendMessage({
    command: 'fetch-mycoin',
  });
  
  // do something with response here, not outside the function
  console.log(response);
});

$('#force-checkin').click(async () => {
  const response = await chrome.runtime.sendMessage({
    command: 'daily-checkin',
  });
});


(async () => {
  const options = await chrome.runtime.sendMessage({
    command: 'request-data',
  });
  console.log('Client:', options);

  const coins = parseInt(options['user-coins'], 10);
  $('#user-coins').text(coins);

  // Create our number formatter.
  const formatter = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  });

  const savings = formatter.format(coins / 100.0);
  console.log(savings);

  $('#user-savings').text(savings);
  $('#pc-streak-rate').text(options['pc-streak-rate']);

  const lastattempt = options['t-last-checkin-attempt'];
  const retrydelay = options['retry-delay'] * 60 * 1000; // convert to ms
  const future = new Date(lastattempt + retrydelay);

  $('#next-try-time').text(`${future.toLocaleDateString()} ${future.toLocaleTimeString()}`);

  const maxretries = options['max-retries'];
  const retrycount = options['retry-count'];
  const lastcheckin = new Date(options['t-last-checkin-attempt']);
  $('#retries-left').text(maxretries - retrycount);
  $('#prev-try-time').text(`${lastcheckin.toLocaleDateString()} ${lastcheckin.toLocaleTimeString()}`);
  
  $('#max-retries').text(maxretries);
  $('#retry-delay').text(options['retry-delay']);
})();

// const H2MS = 60 * 60 * 1000;

// function updateLoop () {
//   // get unix timestamp for last collection
//   chrome.storage.local.get(['last-collected-time']).then((result) => {
//     const lastTime = result['last-collected-time'];
//     if (lastTime !== undefined) {
//       const now = Date.now();
//       const elapsedTime = now - lastTime;
//       console.log("Last time:", lastTime);
//       console.log("Now time:", now);
//       console.log("Elapsed time", elapsedTime);
//       if (elapsedTime >= H2MS * 12) {// 12 hours
//         (async () => {
//           const response = await chrome.runtime.sendMessage({
//           command: 'daily-checkin',
//           });
//         })();
//       }
//     }
//   });

//   setTimeout(updateLoop, 5*60*1000); // 5mins
// };

// updateLoop();