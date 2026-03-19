---
id: troubleshoot-forms
title: Form Submission Troubleshooting
type: troubleshooting
access_level: authenticated
module_tags:
  - forms
priority: 1
owner: openci-support
version: 1.1.0
status: approved
last_reviewed: 2026-03-19
related_ids:
  - module-forms
  - supported-file-formats
  - core-troubleshooting-reference
keywords:
  - form
  - validation
  - submission
  - upload
  - timeout
source_system: openci
---

## Symptoms
- Submission blocked by validation errors
- Upload validation fails
- Form submission times out

## Probable Causes
- Required fields are missing
- Invalid field format (email, phone, date)
- Unsupported attachment format or oversized files
- Unstable network connection

## Resolution Steps

### Error: "Required field missing"
- Check fields marked with * (red asterisk)
- All required fields must have values
- Empty spaces don't count (field must have actual data)

### Error: "Invalid email format"
- Enter valid email like: user@example.com
- Check for extra spaces before/after
- Cannot use special characters except . - _

### Error: "Invalid phone number"
- Enter 10-11 digit number
- Include country code if international (+63 for Philippines)
- Cannot include dashes or parentheses

### Error: "File format not supported"
- Check supported formats: PDF, JPEG, PNG, XLS, DOCX, etc.
- File size must be under 10 MB
- Convert image to JPEG if other formats fail

### Error: "Date out of range"
- Check min/max date restrictions shown in field
- Cannot select future dates (unless specified)
- Use correct date format shown in placeholder

### Submission Timeout (Takes too long)
- Check internet connection (WiFi recommended)
- Make sure all file attachments are not corrupted
- Try submitting from different app instance
- If fails repeatedly, contact Mr. Brann with reference code

### After Successful Submission
- Browser will show confirmation page
- Reference code appears on confirmation
- Keep reference code for future reference
- Form data is stored in OpenCI database

> **NOTE:** Keep submission reference codes for traceability after successful form posting.

## Escalation Path
- Escalate repeated timeout or validation anomalies to operations support with form ID and timestamp

> **WARNING:** Repeated retries without correcting data quality can create duplicate attempts and operational confusion.
