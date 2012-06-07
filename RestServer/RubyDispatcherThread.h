////////////////////////////////////////////////////////////////////////////////
/// @brief dispatcher thread for Ruby actions
///
/// @file
///
/// DISCLAIMER
///
/// Copyright 2004-2012 triAGENS GmbH, Cologne, Germany
///
/// Licensed under the Apache License, Version 2.0 (the "License");
/// you may not use this file except in compliance with the License.
/// You may obtain a copy of the License at
///
///     http://www.apache.org/licenses/LICENSE-2.0
///
/// Unless required by applicable law or agreed to in writing, software
/// distributed under the License is distributed on an "AS IS" BASIS,
/// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
/// See the License for the specific language governing permissions and
/// limitations under the License.
///
/// Copyright holder is triAGENS GmbH, Cologne, Germany
///
/// @author Dr. Frank Celler
/// @author Copyright 2011-2012, triAGENS GmbH, Cologne, Germany
////////////////////////////////////////////////////////////////////////////////

#ifndef TRIAGENS_REST_SERVER_RUBY_DISPATCHER_THREAD_H
#define TRIAGENS_REST_SERVER_RUBY_DISPATCHER_THREAD_H 1

#include "Actions/ActionDispatcherThread.h"

#include "MRuby/MRLoader.h"
#include "MRuby/mr-utils.h"
#include "VocBase/vocbase.h"

// -----------------------------------------------------------------------------
// --SECTION--                                      class ActionDispatcherThread
// -----------------------------------------------------------------------------

////////////////////////////////////////////////////////////////////////////////
/// @addtogroup ArangoDB
/// @{
////////////////////////////////////////////////////////////////////////////////

namespace triagens {
  namespace arango {

////////////////////////////////////////////////////////////////////////////////
/// @brief dispatcher thread
////////////////////////////////////////////////////////////////////////////////

    class RubyDispatcherThread : public ActionDispatcherThread {
      private:
        RubyDispatcherThread (RubyDispatcherThread const&);
        RubyDispatcherThread& operator= (RubyDispatcherThread const&);

////////////////////////////////////////////////////////////////////////////////
/// @}
////////////////////////////////////////////////////////////////////////////////

// -----------------------------------------------------------------------------
// --SECTION--                                      constructors and destructors
// -----------------------------------------------------------------------------

////////////////////////////////////////////////////////////////////////////////
/// @addtogroup ArangoDB
/// @{
////////////////////////////////////////////////////////////////////////////////

      public:

////////////////////////////////////////////////////////////////////////////////
/// @brief constructs a new dispatcher thread
////////////////////////////////////////////////////////////////////////////////

        RubyDispatcherThread (rest::DispatcherQueue*,
                              TRI_vocbase_t*,
                              string const& actionQueue,
                              set<string> const& allowedContexts,
                              std::string startupModules,
                              MRLoader* startupLoader,
                              MRLoader* actionLoader);

////////////////////////////////////////////////////////////////////////////////
/// @}
////////////////////////////////////////////////////////////////////////////////

// -----------------------------------------------------------------------------
// --SECTION--                                    ActionDispatcherThread methods
// -----------------------------------------------------------------------------

////////////////////////////////////////////////////////////////////////////////
/// @addtogroup ArangoDB
/// @{
////////////////////////////////////////////////////////////////////////////////

      public:

////////////////////////////////////////////////////////////////////////////////
/// {@inheritDoc}
////////////////////////////////////////////////////////////////////////////////

        void* context ();

////////////////////////////////////////////////////////////////////////////////
/// @}
////////////////////////////////////////////////////////////////////////////////

// -----------------------------------------------------------------------------
// --SECTION--                                          DispatcherThread methods
// -----------------------------------------------------------------------------

////////////////////////////////////////////////////////////////////////////////
/// @addtogroup ArangoDB
/// @{
////////////////////////////////////////////////////////////////////////////////

      public:

////////////////////////////////////////////////////////////////////////////////
/// {@inheritDoc}
////////////////////////////////////////////////////////////////////////////////

        void reportStatus ();

////////////////////////////////////////////////////////////////////////////////
/// {@inheritDoc}
////////////////////////////////////////////////////////////////////////////////

        void tick (bool idle);

////////////////////////////////////////////////////////////////////////////////
/// @}
////////////////////////////////////////////////////////////////////////////////

// -----------------------------------------------------------------------------
// --SECTION--                                                    Thread methods
// -----------------------------------------------------------------------------

////////////////////////////////////////////////////////////////////////////////
/// @addtogroup ArangoDB
/// @{
////////////////////////////////////////////////////////////////////////////////

      public:

////////////////////////////////////////////////////////////////////////////////
/// {@inheritDoc}
////////////////////////////////////////////////////////////////////////////////

        void run ();

////////////////////////////////////////////////////////////////////////////////
/// @}
////////////////////////////////////////////////////////////////////////////////

// -----------------------------------------------------------------------------
// --SECTION--                                                   private methods
// -----------------------------------------------------------------------------

////////////////////////////////////////////////////////////////////////////////
/// @addtogroup ArangoDB
/// @{
////////////////////////////////////////////////////////////////////////////////

      private:

////////////////////////////////////////////////////////////////////////////////
/// @brief initialises the isolate and context
////////////////////////////////////////////////////////////////////////////////

        void initialise ();

////////////////////////////////////////////////////////////////////////////////
/// @}
////////////////////////////////////////////////////////////////////////////////

// -----------------------------------------------------------------------------
// --SECTION--                                                 private variables
// -----------------------------------------------------------------------------

////////////////////////////////////////////////////////////////////////////////
/// @addtogroup ArangoDB
/// @{
////////////////////////////////////////////////////////////////////////////////

      private:

////////////////////////////////////////////////////////////////////////////////
/// @brief vocbase
////////////////////////////////////////////////////////////////////////////////

        TRI_vocbase_t* _vocbase;

////////////////////////////////////////////////////////////////////////////////
/// @brief V8 isolate
////////////////////////////////////////////////////////////////////////////////

        MR_state_t* _mrs;

////////////////////////////////////////////////////////////////////////////////
/// @brief action queue
////////////////////////////////////////////////////////////////////////////////

        std::string _actionQueue;

////////////////////////////////////////////////////////////////////////////////
/// @brief allowed action contexts
////////////////////////////////////////////////////////////////////////////////

        std::set<std::string> _allowedContexts;

////////////////////////////////////////////////////////////////////////////////
/// @brief modules path
////////////////////////////////////////////////////////////////////////////////

        string _startupModules;

////////////////////////////////////////////////////////////////////////////////
/// @brief startup path
////////////////////////////////////////////////////////////////////////////////

        MRLoader* _startupLoader;

////////////////////////////////////////////////////////////////////////////////
/// @brief action path
////////////////////////////////////////////////////////////////////////////////

        MRLoader* _actionLoader;
    };
  }
}

////////////////////////////////////////////////////////////////////////////////
/// @}
////////////////////////////////////////////////////////////////////////////////

#endif

// Local Variables:
// mode: outline-minor
// outline-regexp: "^\\(/// @brief\\|/// {@inheritDoc}\\|/// @addtogroup\\|/// @page\\|// --SECTION--\\|/// @\\}\\)"
// End:
