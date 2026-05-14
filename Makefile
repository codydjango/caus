.PHONY: install dev start test typecheck clean

install:
	npm install

dev:
	npm run dev

start:
	npm run start

test:
	npm run test

test-run:
	npm run test:run

typecheck:
	npm run typecheck

clean:
	rm -rf node_modules dist
