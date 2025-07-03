# Automated Azure Setup

This folder contains the automated setup scripts for the AI Audio Descriptions application. The goal is to achieve "zero-to-hero in 5 minutes" by automating the creation of all required Azure resources.

## Quick Start

### Prerequisites
- [Azure CLI](https://docs.microsoft.com/en-us/cli/azure/install-azure-cli) installed
- Azure subscription with contributor access
- Bash shell (Linux, macOS, or WSL on Windows)

### 1. Login to Azure
```bash
az login
```

### 2. Run the Setup Script
```bash
./deploy/setup.sh
```

That's it! The script will:
- Create all required Azure resources
- Configure CORS and containers
- Deploy the GPT-4o model
- Generate a SAS token
- Create the `.env` file with all configuration

### 3. Start the Application
```bash
npm install
npm run dev
```

## What Gets Created

The automation creates the following Azure resources:

- **Resource Group**: `rg-ai-audio-descriptions`
- **AI Services**: Multi-service cognitive services resource
  - Includes OpenAI, Speech, and Content Understanding APIs
  - GPT-4o model deployment
- **Storage Account**: Blob storage for video files
  - `audio-description` container
  - CORS enabled for local development
  - SAS token for secure access

## Customization

You can customize the deployment by modifying the parameters in `main.parameters.json`:

- `resourceGroupName`: Name of the resource group
- `location`: Azure region (`westus`, `swedencentral`, or `australiaeast`)
- `namePrefix`: Prefix for all resource names

## Files

- `main.bicep`: Azure Bicep template defining all infrastructure
- `main.parameters.json`: Parameters file for customization
- `setup.sh`: Automated setup script
- `cleanup.sh`: Script to remove all created resources

## Cleanup

To remove all created resources:

```bash
./deploy/cleanup.sh
```

⚠️ **Warning**: This will permanently delete all resources and data!

## Costs

The created resources will incur Azure costs:
- AI Services: Pay-per-use for API calls
- Storage Account: Minimal cost for blob storage
- GPT-4o: Token-based pricing

Monitor your usage in the Azure Portal to avoid unexpected charges.

## Troubleshooting

### Common Issues

1. **Permission denied**: Ensure you have Contributor access to the subscription
2. **Resource already exists**: The script handles existing resources gracefully
3. **Region not supported**: Use one of the supported regions: `westus`, `swedencentral`, `australiaeast`
4. **Deployment timeout**: Some deployments may take 10+ minutes, especially for AI Services

### Getting Help

If you encounter issues:
1. Check the Azure Portal for deployment status
2. Review the script output for error messages
3. Ensure Azure CLI is up to date: `az upgrade`

## Security

- SAS tokens are generated with minimal required permissions
- Tokens expire after 1 year
- CORS is configured only for localhost development
- No secrets are stored in source control