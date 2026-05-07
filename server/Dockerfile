FROM node:20-bookworm

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-pip \
  && rm -rf /var/lib/apt/lists/*

COPY package.json ./
RUN npm install

RUN python3 -m pip install --break-system-packages --no-cache-dir numpy torch

COPY . .

EXPOSE 4000

CMD ["npm", "start"]
