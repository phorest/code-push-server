FROM node:20-alpine
LABEL authors="robert.metcalfe"

ENV EMULATED="true"
ENV SERVER_URL="http://localhost:3000"

EXPOSE 3000

WORKDIR /api

COPY . .

RUN yarn install --production

CMD ["yarn", "build"]

CMD ["yarn", "start"]