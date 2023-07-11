# Use an official Node.js runtime as the base image
FROM node:16

# Set the working directory in the container
WORKDIR /app

# Copy the package.json and package-lock.json files to the container
COPY package*.json ./

# Install the app dependencies
RUN npm install

# Copy the entire project to the container
COPY . .

EXPOSE 3000

# Build the React app for production
RUN npm run build

# Set the command to run the app when the container starts
CMD ["npm", "run", "start"]
