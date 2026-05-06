import type {
	IAuthenticateGeneric,
	Icon,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class KatieSpeakerApi implements ICredentialType {
	name = 'katieSpeakerApi';

	displayName = 'Katie Speaker API';

	icon: Icon = 'file:../icons/katiespeaker.svg';

	documentationUrl = 'https://katiespeaker.com/developers/quickstart';

	properties: INodeProperties[] = [
		{
			displayName: 'Channel API Key',
			name: 'channelApiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			description:
				'The API key for your Katie Speaker channel. Found in your channel settings at app.katiespeaker.com.',
		},
		{
			displayName: 'Base URL',
			name: 'baseUrl',
			type: 'string',
			default: 'https://api.katiespeaker.com',
			description: 'The base URL for the Katie Speaker API',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			// API requires the key in the query string for GET routes and in
			// the body for POST routes; injecting both covers all operations
			// without manual handling in the node.
			qs: {
				channel_apikey: '={{$credentials.channelApiKey}}',
			},
			body: {
				channel_apikey: '={{$credentials.channelApiKey}}',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL: '={{$credentials.baseUrl}}',
			url: '/v1/messaging/subscriber-filters',
			method: 'GET',
		},
	};
}
