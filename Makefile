.PHONY: install dev start test typecheck clean server client

install:
	npm install
	cd client && npm install

dev:
	npm run dev

start:
	npm run start

server:
	tsx src/server/index.ts

client:
	cd client && npm run dev

test:
	npm run test

test-run:
	npm run test:run

typecheck:
	npm run typecheck

clean:
	rm -rf node_modules dist client/node_modules
