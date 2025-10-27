# Conga Advantage Platform Composer API Integration

## Overview

This integration provides a complete web service for interacting with the **Conga Advantage Platform Composer API** to generate contract documents from Salesforce data.

## Components

### Apex Classes

1. **CongaComposerAPIService** - Main orchestrator service
2. **CongaAuthenticationService** - OAuth 2.0 authentication with token caching
3. **CongaMergeService** - Document generation and status operations
4. **CongaAPIWrapper** - Request/response DTOs
5. **CongaAPIException** - Custom exception handling
6. **CongaAPICalloutMock** - Test mock classes
7. **CongaComposerAPIService_Test** - Comprehensive test coverage

### Custom Metadata

**Conga_API_Config__mdt** - API configuration including:
- Client ID
- Client Secret
- API endpoints
- Timeout settings
- Retry configuration

## Setup Instructions

### 1. Configure API Credentials

After deployment, update the Custom Metadata with your Conga credentials:

1. Navigate to **Setup > Custom Metadata Types**
2. Click **Manage Records** next to **Conga API Configuration**
3. Edit the **Default** record
4. Update these fields:
   - **Client Id**: Your Conga OAuth Client ID
   - **Client Secret**: Your Conga OAuth Client Secret
   - **Auth Endpoint**: e.g., `https://api.conga.com/oauth/token`
   - **Base API URL**: e.g., `https://api.conga.com`
   - **Timeout Seconds**: 120 (recommended)
   - **Max Retries**: 3 (recommended)
   - **Is Active**: Checked

### 2. Add Remote Site Settings

Add Conga API endpoint to Remote Site Settings:

1. Navigate to **Setup > Remote Site Settings**
2. Click **New Remote Site**
3. **Remote Site Name**: `Conga_API`
4. **Remote Site URL**: `https://api.conga.com`
5. **Active**: Checked
6. Click **Save**

### 3. Verify Template Configuration

Confirm with your Conga representative:
- ✅ Templates are migrated to Advantage Platform
- ✅ Template IDs/File IDs are available
- ✅ Query IDs are configured (if needed)
- ✅ API access is enabled for your org

## Usage Examples

### Basic Contract Generation

```apex
// Generate contract for a Quote
String quoteId = 'a0X...';
String templateId = 'YOUR_TEMPLATE_ID';
String fileName = 'Contract for ' + quoteName;

try {
    String attachmentId = CongaComposerAPIService.generateContractForQuote(
        quoteId,
        templateId,
        fileName
    );
    System.debug('Contract generated. Attachment ID: ' + attachmentId);
} catch (CongaAPIException e) {
    System.debug('Error: ' + e.getFullErrorMessage());
    // Error is automatically logged to Sentry
}
```

### Contract Generation with Query

```apex
// Generate contract with related data query
String quoteId = 'a0X...';
String templateId = 'YOUR_TEMPLATE_ID';
String queryId = 'YOUR_QUERY_ID';
String fileName = 'Detailed Contract';
String outputFormat = 'PDF'; // or 'DOCX', 'XLSX'

try {
    String attachmentId = CongaComposerAPIService.generateContractForQuote(
        quoteId,
        templateId,
        queryId,
        fileName,
        outputFormat
    );
    System.debug('Contract generated. Attachment ID: ' + attachmentId);
} catch (CongaAPIException e) {
    System.debug('Error: ' + e.getFullErrorMessage());
}
```

### Integration with Existing CongaUtils Pattern

You can integrate this new API with your existing pattern:

```apex
public class CongaUtils {
    
    public static void generateContractUsingAdvantageAPI(String quoteId, Boolean sendEmail) {
        Boolean err = false;
        List<String> attIds = new List<String>();
        
        try {
            SBQQ__Quote__c quote = [SELECT Id, SBQQ__Account__r.Name, SBQQ__StartDate__c 
                                   FROM SBQQ__Quote__c WHERE Id = :quoteId LIMIT 1];
            
            String fileName = quote.SBQQ__Account__r.Name + ' Contract ' + 
                            quote.SBQQ__StartDate__c.format().toString().replace('/','-');
            
            // Use new Advantage Platform API
            String attId = CongaComposerAPIService.generateContractForQuote(
                quoteId,
                'YOUR_TEMPLATE_ID',
                fileName
            );
            
            attIds.add(attId);
            
        } catch(Exception e) {
            Sentry.record(e);
            err = true;
        }
        
        // Send email if successful
        if(!err && sendEmail) {
            // Use existing email logic
            Messaging.SingleEmailMessage email = createContractEmail(quote, attIds);
            Messaging.sendEmail(new List<Messaging.Email>{email});
        }
    }
}
```

## Architecture

### Authentication Flow

1. **Token Request**: OAuth 2.0 Client Credentials grant
2. **Token Caching**: Tokens cached in memory with expiration tracking
3. **Auto-Refresh**: Expired tokens automatically refreshed
4. **Secure Storage**: Credentials stored in Custom Metadata

### Document Generation Flow

1. **Submit Request**: POST to `/api/v2/merge/request`
2. **Poll Status**: GET to `/api/v2/merge/request/{id}` (synchronous polling)
3. **Download Document**: GET to `/api/v2/merge/request/{id}/download`
4. **Create Attachment**: Save as Attachment on Quote record

### Error Handling

- **Retryable Errors**: 429, 500, 502, 503, 504 (automatic retry with exponential backoff)
- **Non-Retryable Errors**: 400, 401, 403, 404 (immediate failure)
- **Timeout**: Configurable timeout (default 120 seconds)
- **Sentry Logging**: All errors automatically logged to Sentry

## API Endpoints

Based on Conga Advantage Platform documentation:

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/oauth/token` | POST | Get OAuth access token |
| `/api/v2/merge/request` | POST | Submit document generation request |
| `/api/v2/merge/request/{id}` | GET | Check merge request status |
| `/api/v2/merge/request/{id}/download` | GET | Download generated document |

## Configuration Reference

### Timeout Settings

- **Authentication**: 30 seconds (fixed)
- **Status Check**: 30 seconds (fixed)
- **Document Generation**: Configurable (default 120 seconds)
- **Document Download**: Configurable (default 120 seconds)

### Polling Settings

- **Max Poll Attempts**: 30
- **Poll Interval**: 10 seconds
- **Total Max Wait Time**: 300 seconds (5 minutes)

## Testing

Run comprehensive test suite:

```bash
sf apex run test --class-names CongaComposerAPIService_Test --result-format human
```

Expected results:
- ✅ All tests pass
- ✅ Code coverage > 90%
- ✅ No deployment warnings

## Troubleshooting

### Authentication Errors

**Error**: `Authentication failed with status 401`

**Solutions**:
- Verify Client ID and Client Secret are correct
- Confirm API access is enabled for your org
- Check Remote Site Settings are configured

### Template Errors

**Error**: `Template not found` or `Invalid template ID`

**Solutions**:
- Confirm template ID from Conga Advantage Platform
- Verify template is published and active
- Check template permissions

### Timeout Errors

**Error**: `Document generation timed out`

**Solutions**:
- Increase timeout in Custom Metadata
- Check template complexity (large templates take longer)
- Verify Conga service status

### Governor Limits

**Error**: `Too many callouts`

**Notes**:
- Each document generation uses up to 6 callouts:
  - 1 for authentication
  - 1 for merge request
  - 1-3 for status polling
  - 1 for download
- Maximum 100 callouts per transaction
- Consider batch processing for bulk generation

## Security Best Practices

1. **Credentials**: Store in Custom Metadata (not hardcoded)
2. **Permissions**: Restrict Custom Metadata access to admins
3. **Rotation**: Rotate Client Secret regularly
4. **Auditing**: Monitor API usage via Debug Logs
5. **Error Logging**: All errors logged to Sentry for monitoring

## Support

For Conga API issues:
- Contact your Conga Account Representative
- Reference: Conga Advantage Platform Composer API Documentation
- Check: [https://documentation.conga.com](https://documentation.conga.com)

For implementation issues:
- Check Sentry for error logs
- Review Debug Logs for detailed callout information
- Contact: sabrown@cargurus.com

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2025 | Initial implementation |

## License

Copyright © 2025 CarGurus. All rights reserved.
