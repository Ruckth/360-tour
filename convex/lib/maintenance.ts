// One backend flag predicate shared by access builders and durable helpers, without a runtime cycle.

export const maintenancePaused = () => process.env.ARCH_RESET_PAUSED === '1';
