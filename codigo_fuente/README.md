# OralFlow

OralFlow is a dental appointment management system built with Django REST Framework for the backend and React (Vite + TypeScript) for the frontend.
The system manages patients, dentists, appointments, medical records, and notifications.

## 📂 Project Structure
ORALFLOW/

├── backend/       
│   ├── citas/            
│   ├── fichas_medicas/    
│   ├── notificaciones/   
│   ├── odontologos/     
│   ├── pacientes/       
│   ├── usuarios/          
│   ├── oralflow_api/   
│   └── manage.py
├── frontend/     
│   ├── src/              
│   ├── public/         
│   └── package.json

└── README.md  


## ⚙️ Requirements
Python 3.11+
Node.js 18+
PostgreSQL 15+
Git

## 🚀 Backend (Django REST Framework)
cd backend
### Create virtual environment
python -m venv venv
### Activate environment
#### Windows
venv\Scripts\activate
#### Linux/Mac
source venv/bin/activate
### Install dependencies
pip install -r requirements.txt
### Make migrations
python manage.py makemigrations
### Run migrations
python manage.py migrate
# Start server
python manage.py runserver

## 💻 Frontend (React + Vite + TypeScript)
cd frontend
### Install dependencies
npm install
### Start development server
npm run dev


## 📜 License
This project is currently private. License to be defined.


