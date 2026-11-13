import { test as setup } from '@playwright/test';
import { clerkSetup } from '@clerk/testing/playwright';
setup('initialize Clerk test-tenant bot protection token', async () => { await clerkSetup(); });
