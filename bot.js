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
  const response = await chrome.runtime.sendMessage({
    command: 'request-data',
  });
  console.log('Client:', response);

  $('#user-coins').text(response['user-coins']);
  $('#user-savings').text(response['user-savings']);
})();

const H2MS = 60 * 60 * 1000;

function updateLoop () {
  // get unix timestamp for last collection
  chrome.storage.sync.get(['last-collected-time']).then((result) => {
    const lastTime = result['last-collected-time'];
    if (lastTime !== undefined) {
      const now = Date.now();
      const elapsedTime = now - lastTime;
      console.log("Last time:", lastTime);
      console.log("Now time:", now);
      console.log("Elapsed time", elapsedTime);
      if (elapsedTime >= H2MS * 12) {// 12 hours
        (async () => {
          const response = await chrome.runtime.sendMessage({
          command: 'daily-checkin',
          });
        })();
      }
    }
  });

  setTimeout(updateLoop, 5*60*1000); // 5mins
};

updateLoop();

// setInterval(() => {
//   chrome.storage.sync.get(['last-collected-time']).then((result) => {
//     console.log("Value is " + result['last-collected-time']);
//   });
  
// }, 5 * 60 * 1000);

// set initial values for coins and savings
// chrome.storage.sync.get(['user-coins', 'user-savings']).then((result) => {
//   console.log("Value is " + result['user-coins']);
// });