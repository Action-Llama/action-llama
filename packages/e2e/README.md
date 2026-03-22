# End-to-End Tests

This package contains end-to-end tests for Action Llama that test complete workflows including deployment scenarios.

## Requirements

- **Docker**: The e2e tests require Docker to be installed and running
- **Node.js 20+**: As specified in package.json engines

## Running the tests

### Local development

```bash
# From the repository root
npm run test:e2e
```

### With Docker Compose (alternative)

```bash
# From the e2e package directory
npm run test:local
```

This will start the tests in a Docker environment using docker-compose.

## What the tests cover

- **CLI flows**: Testing the Action Llama CLI commands
- **Deployment flows**: Testing deployment to VPS environments  
- **Web UI flows**: Testing web interface interactions

## Test environment

The e2e tests create isolated Docker containers for each test run:

1. **Local Action Llama container**: Runs Action Llama in test mode
2. **VPS container**: Simulates a target VPS with SSH and Docker
3. **Test network**: Isolated network for container communication

## Troubleshooting

### Docker not available

If you see errors about Docker not being available:

1. Ensure Docker is installed: https://docs.docker.com/get-docker/
2. Start the Docker service/daemon
3. Verify Docker is accessible: `docker ps`

### Container cleanup

If tests fail and leave containers running:

```bash
# Clean up test containers
docker ps -a | grep action-llama-e2e | awk '{print $1}' | xargs docker rm -f

# Clean up test network
docker network rm action-llama-e2e
```

### CI/CD environments

E2E tests are designed to run in environments with Docker support. They will skip gracefully if Docker is not available rather than failing the entire test suite.