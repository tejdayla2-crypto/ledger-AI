const cron = require('node-cron');
const { backfillMonthlyReports, preparePreviousMonthForAllUsers } = require('../lib/monthlyReports');

function startMonthlyReportJob() {
  try {
    backfillMonthlyReports();
    preparePreviousMonthForAllUsers();
  } catch (error) {
    console.error('[Monthly report] Startup preparation failed:', error.message);
  }

  cron.schedule('5 0 1 * *', () => {
    preparePreviousMonthForAllUsers();
  }, { timezone: 'UTC' });
  console.log('[Monthly report] Automatic month-end reports scheduled (1st of each month at 00:05).');
}

module.exports = { startMonthlyReportJob };
