targetScope = 'subscription'

@description('Name of the azd environment')
param environmentName string

@description('Azure region for the deployment')
param location string

@description('Object ID of the developer running the application')
param principalId string

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
    principalId: principalId
  }
}

output AZURE_RESOURCE_GROUP string = resourceGroup.name
output FOUNDRY_RESOURCE string = resources.outputs.FOUNDRY_RESOURCE
output FOUNDRY_RESOURCE_ID string = resources.outputs.FOUNDRY_RESOURCE_ID
output GPT_DEPLOYMENT string = resources.outputs.GPT_DEPLOYMENT
