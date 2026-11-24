// Add a clock synchronization endpoint
socket.on('clockSync', (data, callback) => {
  if (typeof callback === 'function') {
    callback({ serverTime: Date.now() });
  }
}); 