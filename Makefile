PROJECT_NAME ?= nebardak
COMPOSE_PROD = docker compose -p $(PROJECT_NAME) -f docker-compose.prod.yml --env-file .env

.PHONY: prod-build prod-up prod-down prod-ps prod-logs prod-rebuild

prod-build:
	$(COMPOSE_PROD) build next nest

prod-up:
	$(COMPOSE_PROD) up -d --no-build

prod-down:
	$(COMPOSE_PROD) down

prod-ps:
	$(COMPOSE_PROD) ps

prod-logs:
	$(COMPOSE_PROD) logs -f

prod-rebuild: prod-build prod-up
