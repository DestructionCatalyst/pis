FROM node:20.10.0-slim

RUN mkdir /opt/node_app && chown node:node /opt/node_app
WORKDIR /opt/node_app

USER node
COPY --chown=node:node ./package*.json ./
RUN npm install

COPY --chown=node:node . .

CMD [ "node", "./index.js" ]