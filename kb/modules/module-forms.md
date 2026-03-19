---
id: module-forms
title: Form Builder Module
type: module
access_level: authenticated
module_tags:
  - forms
priority: 2
owner: openci-operations
version: 1.1.0
status: approved
last_reviewed: 2026-03-19
related_ids:
  - troubleshoot-forms
  - supported-file-formats
keywords:
  - form builder
  - validation
  - uploads
  - conditional fields
  - multi-step
source_system: openci
---

## Overview
The Form Builder module allows customization of data collection forms for different banks and use cases.

## Core Capabilities
- Drag-and-drop form builder
- Field validation (required, regex patterns, date ranges)
- Conditional fields (show/hide based on values)
- File upload fields with type restrictions
- Multi-step forms for complex data collection
- Reference code tracking after successful submission

## Supported File Types for Upload
PDF, JPEG, PNG, JPG, HEIC, HEIF, CSV, XLSX, XLS, DOC, DOCX, TXT, ZIP, RAR

## Form Submission Process
1. Validation happens client-side first
2. Server-side validation is mandatory
3. Failed submissions retain user data
4. Successful submissions get unique reference codes

> **IMPORTANT:** Server-side validation is mandatory even when client-side validation passes.

## Constraints
- Upload fields must enforce allowed formats and size rules (max 10 MB)
- Submission should preserve user data on validation failure
- All required fields must be completed before submission

> **WARNING:** Unsupported file formats and oversized files must be rejected to avoid bad data entry and processing failures.

## Related Workflows
- Form submission troubleshooting
- Reference code tracking after successful submission
- Supported file formats glossary
