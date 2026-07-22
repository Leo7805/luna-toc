/**
 * Starts LunaTOC's legacy DOM application and isolated React UI environment
 * from the Chrome Content Script entry.
 */
import { initializeApplication } from '@/app/applicationShell';
import { initializeReactHost } from '@/reactHost/reactHost';

// Start the existing sidebar and browser-integration features.
void initializeApplication();

// Prepare the Shadow DOM boundary used by current and future React interfaces.
void initializeReactHost();
