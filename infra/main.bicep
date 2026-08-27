targetScope = 'subscription'

@description('Name of the azd environment')
param environmentName string

@description('Azure region for the deployment')
param location string

@description('Expiration time for the development storage SAS token')
param sasExpiration string = dateTimeAdd(utcNow(), 'P1Y')

var resourceGroupName = 'rg-aiad-${environmentName}'

resource resourceGroup 'Microsoft.Resources/resourceGroups@2025-04-01' = {
  name: resourceGroupName
  location: location
  tags: {
    'azd-env-name': environmentName
  }
}

module resources './resources.bicep' = {
  name: 'ai-audio-descriptions'
  scope: resourceGroup
  params: {
    location: location
    sasExpiration: sasExpiration
  }
}

output AZURE_RESOURCE_GROUP string = resourceGroup.name
output VITE_FOUNDRY_RESOURCE string = resources.outputs.VITE_FOUNDRY_RESOURCE
output VITE_FOUNDRY_SPEECH_ENDPOINT string = resources.outputs.VITE_FOUNDRY_SPEECH_ENDPOINT
output VITE_GPT_DEPLOYMENT string = resources.outputs.VITE_GPT_DEPLOYMENT
output VITE_STORAGE_ACCOUNT string = resources.outputs.VITE_STORAGE_ACCOUNT

@secure()
output VITE_FOUNDRY_KEY string = resources.outputs.VITE_FOUNDRY_KEY

@secure()
output VITE_BLOB_SAS_TOKEN string = resources.outputs.VITE_BLOB_SAS_TOKEN
