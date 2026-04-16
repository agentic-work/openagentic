// Maintenance mode control
// This file can be modified to enable/disable maintenance mode
if (typeof MAINTENANCE_MODE !== 'undefined' && MAINTENANCE_MODE === true) {
  localStorage.setItem('maintenance_mode', 'true');
} else if (typeof MAINTENANCE_MODE !== 'undefined' && MAINTENANCE_MODE === false) {
  localStorage.removeItem('maintenance_mode');
}