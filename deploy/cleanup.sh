#!/bin/bash

# AI Audio Descriptions - Cleanup Script
# This script removes all Azure resources created by the setup script

set -e  # Exit on any error

# Configuration
RESOURCE_GROUP_NAME="rg-ai-audio-descriptions"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🧹 AI Audio Descriptions - Cleanup Script${NC}"
echo -e "${BLUE}==========================================${NC}"
echo

# Check if Azure CLI is installed
if ! command -v az &> /dev/null; then
    echo -e "${RED}❌ Azure CLI is not installed.${NC}"
    exit 1
fi

# Check if user is logged in
if ! az account show &> /dev/null; then
    echo -e "${RED}❌ You are not logged in to Azure. Please run 'az login' first.${NC}"
    exit 1
fi

# Check if resource group exists
if ! az group show --name "$RESOURCE_GROUP_NAME" &> /dev/null; then
    echo -e "${YELLOW}⚠️  Resource group '${RESOURCE_GROUP_NAME}' does not exist.${NC}"
    echo -e "${GREEN}✅ Nothing to clean up.${NC}"
    exit 0
fi

# Get subscription info
SUBSCRIPTION_NAME=$(az account show --query "name" -o tsv)
echo -e "${GREEN}✅ Logged in to Azure${NC}"
echo -e "   Subscription: ${SUBSCRIPTION_NAME}"
echo

# Show resources that will be deleted
echo -e "${YELLOW}⚠️  This will DELETE the following resource group and ALL resources within it:${NC}"
echo "   • Resource Group: ${RESOURCE_GROUP_NAME}"
echo
echo -e "${RED}📋 Resources to be deleted:${NC}"
az resource list --resource-group "$RESOURCE_GROUP_NAME" --query "[].{Name:name, Type:type}" --output table

echo
echo -e "${RED}⚠️  THIS ACTION CANNOT BE UNDONE!${NC}"
read -p "Are you sure you want to delete all resources? Type 'DELETE' to confirm: " CONFIRMATION

if [ "$CONFIRMATION" != "DELETE" ]; then
    echo -e "${YELLOW}❌ Cleanup cancelled.${NC}"
    exit 1
fi

echo -e "${YELLOW}Deleting resource group and all resources...${NC}"
az group delete --name "$RESOURCE_GROUP_NAME" --yes --no-wait

echo -e "${GREEN}✅ Deletion initiated.${NC}"
echo -e "${BLUE}ℹ️  Resources are being deleted in the background. This may take several minutes.${NC}"
echo -e "${BLUE}   You can check the status in the Azure Portal.${NC}"

# Clean up local .env file
if [ -f ".env" ]; then
    echo -e "${YELLOW}Removing local .env file...${NC}"
    rm .env
    echo -e "${GREEN}✅ Local .env file removed.${NC}"
fi

echo
echo -e "${GREEN}🧹 Cleanup complete!${NC}"