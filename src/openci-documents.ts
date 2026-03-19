/**
 * OPENCI SAMPLE DOCUMENTS
 * Pre-populated knowledge base for vector store initialization
 * These documents provide comprehensive OpenCI platform knowledge
 */

import { VectorDocument } from './vector-store';

export const OPENCI_SAMPLE_DOCUMENTS: VectorDocument[] = [
  // ═══════════════════════════════════════════════════════════════
  // MODULE DOCUMENTATION
  // ═══════════════════════════════════════════════════════════════
  {
    id: 'module-ci',
    content: `Credit Investigation (CI) Module
Module Overview: The CI module is used for conducting comprehensive credit investigations on clients. It includes gathering financial information, assessing creditworthiness, and analyzing payment history.

Key Features:
- Client profile creation and management
- Credit score tracking and updates
- Financial documentation upload and storage
- Automated credit analysis reports
- Bank integration for real-time credit data
- Historical credit tracking

Supported Banks: TFS, SBF, CBS, BDO, BPI, CSB, ESQ, EWB, FHL, FUSE, HOME CREDIT, HSBC, PNB, RSB, RCBC, PSB, UBP, MANULIFE, MAYA, MBTC, MSB, TALA, AUB

All banks can use CI module for credit assessment and client profiling.`,
    type: 'module',
    source: 'openci_modules',
    access_level: 'authenticated',
  },
  {
    id: 'module-dl',
    content: `Demand Letter (DL) Module
Module Overview: The DL module automates the creation, printing, and tracking of demand letters for debt collection.

Workflow Status Flow:
1. GENERATED - Letter created in system with client information
2. PRINTED - Physical letter printed and ready for distribution
3. RELEASED TO OIC - Handed to Officer in Charge for processing
4. RELEASED TO FM - Forwarded to Field Manager for assignment
5. VISITED - Field agent completed visit to debtor location
6. FINAL STATE - DONE (successful), RETURNED (unsuccessful), or PULLED_OUT (case closed)

Critical Rules:
- All required fields must be filled before generating
- Physical copies must be printed within 24 hours of generation
- Status updates must be sequential (cannot skip steps)
- Successful visits must include photo documentation
- Return reason codes are mandatory for RETURNED status`,
    type: 'module',
    source: 'openci_modules',
    access_level: 'authenticated',
  },
  {
    id: 'module-skip-collect',
    content: `Skip & Collect (SC) Module
Module Overview: The SC module manages skip tracing and collection activities for field agents. It tracks agent location, activities, and debtor contact outcomes.

Activity Types:
- DRIVING: Agent in transit to debtor location (geo-tracked)
- SKIP_TRACE: Locating debtor at new address (when address changed)
- TOUCH_POINT: Initial contact with debtor (call, SMS, visit)
- DISPOSITION: Final outcome recorded (agreed to pay, refused, unavailable)

Live Map Status Indicators:
- 🟢 GREEN (Live): Agent actively online with GPS enabled
- ⚪ GREY (Stale): No activity for >10 minutes
- 🔵 BLUE (Home/Inactive): Agent logged in but inactive status

Location Requirements:
- GPS must be enabled at all times during shifts
- Tagging is mandatory for all activities
- VRP/OSRM should NOT be used as alternative
- If visibility issues prevent tagging, escalate to Area Coordinator`,
    type: 'module',
    source: 'openci_modules',
    access_level: 'authenticated',
  },
  {
    id: 'module-workforce',
    content: `Workforce Management (WFM) Module
Module Overview: The WFM module manages field agent scheduling, task assignment, and performance tracking.

Operational Guidelines:
- Standard work hours: 8 AM - 5 PM
- Default break: 1 hour (lunch)
- Maximum work-without-break: 4 hours
- "Waiting" status indicates gaps in activity (red flags for supervisor)

Assignment Rules:
- Tasks assigned by area/region to agents
- Agent location affects task routing
- Estimated travel time calculated automatically
- Task priority levels: URGENT, HIGH, NORMAL, LOW

Performance Metrics:
- Tasks completed per day
- Average time per task
- GPS accuracy and tagging compliance
- Photo submission rate and quality`,
    type: 'module',
    source: 'openci_modules',
    access_level: 'authenticated',
  },
  {
    id: 'module-forms',
    content: `Form Builder Module
Module Overview: The Form Builder module allows customization of data collection forms for different banks and use cases.

Features:
- Drag-and-drop form builder
- Field validation (required, regex patterns, date ranges)
- Conditional fields (show/hide based on values)
- File upload fields with type restrictions
- Multi-step forms for complex data collection

Supported File Types for Upload:
PDF, JPEG, PNG, JPG, HEIC, HEIF, CSV, XLSX, XLS, DOC, DOCX, TXT, ZIP, RAR

Form Submission:
- Validation happens client-side first
- Server-side validation is mandatory
- Failed submissions retain user data
- Successful submissions get unique reference codes`,
    type: 'module',
    source: 'openci_modules',
    access_level: 'authenticated',
  },

  // ═══════════════════════════════════════════════════════════════
  // TROUBLESHOOTING GUIDES
  // ═══════════════════════════════════════════════════════════════
  {
    id: 'troubleshoot-lark',
    content: `Lark Access Issues - Troubleshooting Guide
Problem: Cannot login to Lark application

Solution Steps:
1. Check internet connection (WiFi or mobile data)
2. Verify username and password are correct
3. Try clearing app cache: Settings > Apps > Lark > Storage > Clear Cache
4. Try logging in on another device to verify account status

Password Reset:
- Password resets are handled by IT department ONLY
- Do NOT attempt password resets in-app multiple times (causes lockout)
- Contact IT with your employee ID and issue description
- IT will send reset link via email within 1 hour

Multi-Device Login:
- Each user can be logged in on maximum 1 device
- To switch devices, logout from current device first
- If locked out, IT can force logout from admin panel

IT Contact Information:
- For urgent issues: IT Hotline available 24/7
- For non-urgent: Submit ticket through IT portal
- Provide error codes and screenshot for faster resolution`,
    type: 'troubleshooting',
    source: 'openci_support',
    access_level: 'authenticated',
  },
  {
    id: 'troubleshoot-gps',
    content: `GPS & Location Issues - Troubleshooting Guide
Problem: GPS location not updating or locations shown as stale

Solution Steps:
1. Check device location permissions:
   - Settings > Apps > ChatAI > Permissions > Location
   - Change to "Always Allow" (not "Only While Using App")
   
2. Verify GPS is enabled:
   - Settings > Location > Make sure "Location" toggle is ON
   
3. Improve GPS signal:
   - Go outdoors away from buildings
   - Wait 2-3 minutes for initial GPS lock
   - Note: GPS works better with clear sky view
   
4. Check internet connection:
   - GPS needs internet to verify location
   - Mobile data must be ON or WiFi must be connected
   - Check WiFi/signal strength indicator
   
5. Restart location services:
   - Go to Settings > Location > Toggle OFF then ON
   - Restart the ChatAI app after this

If Issue Persists:
- Uninstall and reinstall the app
- Factory reset location services
- Contact IT with device model and Android version`,
    type: 'troubleshooting',
    source: 'openci_support',
    access_level: 'public',
  },
  {
    id: 'troubleshoot-app-update',
    content: `App Update Issues - Troubleshooting Guide
Problem: App not updating or update button missing in Play Store

Solution Steps:
1. Manual Uninstall & Reinstall:
   - Go to Ask Google Play Store
   - Search for "ChatAI OpenCI"
   - Click "UNINSTALL" button
   - After uninstall, click "INSTALL" button
   - Wait for installation to complete (5-10 minutes)
   
2. Clear Play Store Cache:
   - Settings > Apps > Google Play Store
   - Click "Storage" > "Clear Cache"
   - Return to Play Store and try install again
   
3. Force Stop App:
   - Settings > Apps > ChatAI
   - Click "Force Stop"
   - Wait 10 seconds, then open app again
   
4. Check Storage Space:
   - Settings > Storage > Check available space
   - Need at least 100 MB free for app + cache
   - Delete unused apps if storage is low
   
5. Verify Google Account:
   - Settings > Accounts > Google > Check if account is active
   - Remove and re-add account if issues persist

If Issue Still Persists:
- Contact IT with error code shown in Play Store
- Don't try updating more than 3 times (may lock update)
- Mr. Brann handles severe app update issues`,
    type: 'troubleshooting',
    source: 'openci_support',
    access_level: 'public',
  },
  {
    id: 'troubleshoot-forms',
    content: `Form Submission Issues - Troubleshooting Guide
Problem: Form validation errors preventing submission

Common Validation Errors:

1. "Required field missing":
   - Check fields marked with * (red asterisk)
   - All required fields must have values
   - Empty spaces don't count (field must have actual data)

2. "Invalid email format":
   - Enter valid email like: user@example.com
   - Check for extra spaces before/after
   - Cannot use special characters except . - _

3. "Invalid phone number":
   - Enter 10-11 digit number
   - Include country code if international (+63 for Philippines)
   - Cannot include dashes or parentheses

4. "File format not supported":
   - Check supported formats: PDF, JPEG, PNG, XLS, DOCX, etc.
   - File size must be under 10 MB
   - Convert image to JPEG if other formats fail

5. "Date out of range":
   - Check min/max date restrictions shown in field
   - Cannot select future dates (unless specified)
   - Use correct date format shown in placeholder

Submission Timeout (Takes too long):
- Check internet connection (WiFi recommended)
- Make sure all file attachments are not corrupted
- Try submitting from different app instance
- If fails repeatedly, contact Mr. Brann with reference code

After Successful Submission:
- Browser will show confirmation page
- Reference code appears on confirmation
- Keep reference code for future reference
- Form data is stored in OpenCI database`,
    type: 'troubleshooting',
    source: 'openci_support',
    access_level: 'authenticated',
  },

  // ═══════════════════════════════════════════════════════════════
  // PROCEDURES & WORKFLOWS
  // ═══════════════════════════════════════════════════════════════
  {
    id: 'procedure-dl-generation',
    content: `Procedure: Creating and Managing Demand Letters
Step-by-Step Guide for DL Workflow

Step 1: Create Demand Letter
1. Open DL module
2. Click "New Demand Letter"
3. Enter client information:
   - Client full name (required)
   - Client ID (if in system)
   - Amount owed (required)
   - Bank code (required)
   - Loan account number (required)
4. Select letter template
5. Review pre-filled content
6. Make edits if needed
7. Click "Generate" button
Status becomes: GENERATED

Step 2: Print Demand Letter
1. After generation, system shows "Print" option
2. Click "Print" and select printer
3. Use official letterhead paper
4. Print immediately (within 24 hours)
5. File paper copy in client folder
Status becomes: PRINTED

Step 3: Release to OIC
1. Submit printed copy to Officer in Charge
2. Get OIC signature/approval
3. Update status in system to "RELEASED TO OIC"
4. Attach photo of signed approval

Step 4: Release to Field Manager
1. OIC forwards to Field Manager
2. FM assigns to field agents
3. Update status to "RELEASED TO FM"
4. Agents receive notification with DL details

Step 5: Field Visit
1. Agent visits debtor location
2. Provides copy of demand letter
3. Records visit details and outcome
4. Takes photo of debtor interaction (with consent)
5. Updates status to "VISITED"

Step 6: Close Case
1. After visit, DL moves to final status:
   - DONE: Debtor agreed and made payment/arrangement
   - RETURNED: Debtor refused or not available
   - PULLED_OUT: Case closed per bank request
2. Add notes explaining final outcome
3. Archive case if DONE
4. Create follow-up task if debt still pending`,
    type: 'procedure',
    source: 'openci_workflows',
    access_level: 'authenticated',
  },
  {
    id: 'procedure-field-checkin',
    content: `Procedure: Daily Field Check-In and Activity Logging
Step-by-Step Guide for Field Agents

Morning Check-In (8:00 AM):
1. Open ChatAI app
2. Verify GPS is enabled and working
3. Click "Check In" button
4. Accept location permission
5. System logs your starting location
6. Status becomes "ACTIVE"

During Day (Every 30 minutes):
1. System auto-logs your location every 30 min
2. If GPS signal lost, reconnect to internet
3. Update activity status when changing tasks
4. Available statuses: DRIVING, SKIP_TRACE, TOUCH_POINT, DISPOSITION

Activity Transitions:
- DRIVING: Moving between client locations (auto-tagged)
- SKIP_TRACE: Searching for client at new address (manual toggle)
- TOUCH_POINT: Contacting/meeting client (field work)
- DISPOSITION: Recording final outcome (case closure)

Photo Requirements:
- Take real-time photos during field work
- Do NOT batch upload photos later
- Photos must show: agent present, client interaction, location context
- File photos within app immediately
- Keep photo quality high (clear, well-lit)

Break Procedure:
1. Mark break start time in app
2. Take maximum 1 hour break
3. Log break location
4. Mark break end when resuming work
5. Avoid gaps (red flag = suspicious timing)

Evening Check-Out (5:00 PM):
1. Complete all daily tasks
2. Click "Check Out" button
3. Confirm final location
4. Submit all pending activity reports
5. Status becomes "INACTIVE"

End-of-Day Reporting:
1. Submit summary of day's activities
2. Number of DLs served
3. Number of touch points
4. Cases for follow-up
5. Issues encountered`,
    type: 'procedure',
    source: 'openci_workflows',
    access_level: 'authenticated',
  },

  // ═══════════════════════════════════════════════════════════════
  // FAQ
  // ═══════════════════════════════════════════════════════════════
  {
    id: 'faq-banks',
    content: `Frequently Asked Questions - Banks & Partners
Q: Which banks are supported in OpenCI?
A: All major Filipino banks and financial partners:
TFS, SBF, CBS, BDO, BPI, CSB, ESQ, EWB, FHL, FUSE, HOME CREDIT, HSBC, PNB, RSB, RCBC, PSB, UBP, MANULIFE, MAYA, MBTC, MSB, TALA, AUB

Q: Can I work with multiple banks?
A: Yes, agents can handle cases from different banks. Just make sure to select correct bank when creating demand letters.

Q: How do I know which bank a case belongs to?
A: Bank code is shown in the case details. Each case is marked with its bank.

Q: Are there different procedures for different banks?
A: The core procedure is the same, but some banks have additional requirements shown in system alerts.`,
    type: 'faq',
    source: 'openci_faq',
    access_level: 'authenticated',
  },
  {
    id: 'faq-tagging',
    content: `Frequently Asked Questions - Location Tagging & GPS
Q: What is mandatory tagging?
A: Every activity (visit, contact) must have GPS location tagged. VRP/OSRM cannot replace this requirement.

Q: What if I can't get GPS signal in an area?
A: If GPS unavailable, you cannot tag that activity. Escalate to Area Coordinator for approval to work without tagging.

Q: Can I tag location manually instead of GPS?
A: No, all tagging must be GPS-verified. Manual entry is not accepted.

Q: What does "Visibility Issues = No Tagging" mean?
A: If the system cannot verify your location (due to terrain, trees, buildings), tagging will fail. Contact Area Coordinator for next steps.

Q: How accurate does GPS need to be?
A: Within 100 feet (30 meters) of actual location for valid tagging.`,
    type: 'faq',
    source: 'openci_faq',
    access_level: 'authenticated',
  },
];

/**
 * Initialize vector store with sample documents
 */
export async function loadSampleDocuments(vectorStore: any): Promise<void> {
  try {
    console.log(`\n📚 Loading ${OPENCI_SAMPLE_DOCUMENTS.length} sample documents into vector store...`);
    
    await vectorStore.bulkAddDocuments(OPENCI_SAMPLE_DOCUMENTS);
    
    const stats = await vectorStore.getStats();
    console.log(`✓ Vector store loaded successfully!`);
    console.log(`  Total documents: ${stats.total}`);
    console.log(`  Documents by type:`);
    stats.byType.forEach((typeCount: any) => {
      console.log(`    - ${typeCount.type}: ${typeCount.count}`);
    });
  } catch (error) {
    console.error('Error loading sample documents:', error);
  }
}

export default OPENCI_SAMPLE_DOCUMENTS;
