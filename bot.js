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
  
  // do something with response here, not outside the function
  console.log(response);
});